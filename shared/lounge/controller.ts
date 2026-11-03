import { MAX_FRAME_BYTES, parseMessage, type LoungeDraft, type LoungeMessage,
  type LoungeSession, type LoungeSnapshot } from './types';
import { avatarData } from './avatar';
import { browserLoungeRuntime, type LoungeRuntime } from './runtime';
import { historyKey, historyScope, historyPage, historyPosition, recentMessages, RECENT_MESSAGE_LIMIT,
  type HistoryPage, type HistoryQuery } from './archive';
import { searchLoungeHistory } from './history';
import { mergeContact, messageConversation, type LoungeContact } from './contacts';
import { LoungeContactSync } from './contactSync';
import { LoungeDirectDelivery } from './directDelivery';
import { LoungeDeliveryTransport } from './deliveryTransport';
import { LoungeDirectState } from './directState';
import { authorize, AUTH_TIMEOUT_MS } from './authorize';
import { isCurrentDirect, removedConversation } from './removeConversation';
import { needsDeliveryWork } from './delivery';
import { LoungeProfiles } from './profiles';
import type { LoungeReply } from './reply';
import { LoungeAccountLookup, recentSpeakers } from './accountLookup';
import { LoungeSubmissions } from './submissions';
import { LoungeDeviceSync } from './deviceSync';
import { synchronizedSnapshot } from './syncSnapshot';
import { notificationSettingsUpdate, notificationUnread } from './notificationSettings';
import { LoungeAttachmentManager } from './attachmentManager';
import { ReconnectBackoff } from '../realtime/reconnectBackoff';

const HEARTBEAT_MS = 20_000;
const STALE_MS = 65_000;
const AUTH_RENEW_MS = 4 * 60_000;

/** Owns the live connection and recent messages; optional storage archives received content locally. */
export class LoungeController {
  private state: LoungeSnapshot;
  private listeners = new Set<() => void>();
  private socket?: WebSocket;
  private running = false;
  private connecting = false;
  private viewing = false;
  private generation = 0;
  private readonly backoff: ReconnectBackoff;
  private received = 0;
  private authorized = 0;
  private renewing = false;
  private renewalStarted = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly submissions = new LoungeSubmissions();
  private unsubscribe?: () => void;
  private lifecycle = 0;
  private writes: Promise<void> = Promise.resolve();
  private historyFailures = 0;
  private recent: LoungeMessage[] = [];
  private watched = '';
  private readonly directState = new LoungeDirectState();
  private historyEpoch = 0;
  private readonly profiles: LoungeProfiles;
  private readonly delivery: LoungeDirectDelivery;
  private readonly transport = new LoungeDeliveryTransport();
  private readonly accountLookup = new LoungeAccountLookup();
  private readonly contactSync: LoungeContactSync;
  private readonly deviceSync: LoungeDeviceSync;
  readonly attachments: LoungeAttachmentManager;

  constructor(private readonly session?: LoungeSession, private readonly runtime: LoungeRuntime = browserLoungeRuntime) {
    this.backoff = new ReconnectBackoff({ maximumMs: 15_000, random: runtime.retryRandom });
    this.profiles = new LoungeProfiles(session?.avatars);
    this.attachments = new LoungeAttachmentManager({ session, randomId: runtime.randomId });
    this.state = { status: session ? 'connecting' : 'signed-out', messages: [], unread: 0,
      policy: { moderator: false, mutedUntil: null }, historyRevision: 0, historyError: false,
      contacts: [], blocked: [], directAvailable: false, conversation: '', unreadByConversation: {} };
    this.deviceSync = new LoungeDeviceSync({ session, deviceId: runtime.randomId, flush: () => this.writes,
      restored: messages => this.restoreSynchronized(messages),
      accept: message => isCurrentDirect(message, peer => this.directState.generation(peer)),
      error: failed => { if (this.running) this.update({ deviceSyncError: failed }); } });
    this.contactSync = new LoungeContactSync({ snapshot: () => this.state, update: change => this.update(change),
      persist: contact => this.persistContact(contact), watch: () => this.syncWatch(),
      profile: user => this.profiles.user(user), account: session?.account,
      send: frame => this.state.status === 'connected' && this.transport.send(this.socket, frame) });
    this.delivery = new LoungeDirectDelivery({
      self: () => this.state.user,
      enabled: () => this.running && this.state.status === 'connected' && this.state.directAvailable,
      online: id => this.state.contacts.some(contact => contact.user.id === id && contact.online === true),
      readable: message => this.canRead() && message.conversation === this.state.conversation,
      allowed: message => this.allowDelivery(message),
      find: key => this.findMessage(key), page: query => query.pendingOnly && !this.session?.history?.get
        ? Promise.resolve({ messages: [] }) : this.searchHistory(query),
      permission: peer => this.directState.permission(peer),
      generation: peer => this.directState.generation(peer), ready: peer => this.directState.ready(peer),
      publish: (message, fresh) => this.publishDirect(message, fresh),
      transmit: frame => this.state.status === 'connected' && this.transport.send(this.socket, frame),
      error: () => this.update({ historyError: true }),
    });
  }
  snapshot = () => this.state;
  recentSpeakers = (after = -Infinity) => recentSpeakers(this.recent, this.state.user?.id, after)
    .map(user => this.profiles.user(user));
  get historyScope() {
    return historyScope(this.session?.baseUrl ?? '',
      this.session?.account ?? this.session?.userId ?? this.state.user?.id ?? '');
  }
  findAccount(query: string, signal: AbortSignal) {
    if (this.state.status !== 'connected' || !this.state.directAvailable
      || !this.state.accountLookupAvailable || !this.socket) {
      return Promise.reject(new Error('client.lounge.accountLookupFailed'));
    }
    return this.accountLookup.find({ socket: this.socket, id: this.runtime.randomId(), query, signal })
      .then(user => this.profiles.user(user));
  }
  /** Prefer the latest incoming unread message for private conversation previews. */
  conversationPreview(conversation: string) {
    const unread = !!conversation && (this.state.unreadByConversation[conversation] ?? 0) > 0;
    for (let index = this.recent.length - 1; index >= 0; index--) {
      const message = this.recent[index];
      if ((message.conversation ?? '') !== conversation) continue;
      if (unread && (message.sender.id === this.state.user?.id || message.delivery?.status === 'read')) continue;
      return message;
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(value: Partial<LoungeSnapshot>) {
    this.state = this.profiles.decorate({ ...this.state, ...value });
    this.state.unread = notificationUnread(this.state);
    this.listeners.forEach(listener => listener());
  }

  start() {
    if (this.running || !this.session) return;
    this.running = true;
    this.lifecycle++;
    this.delivery.start();
    void this.restoreHistory();
    void this.restoreContacts();
    this.unsubscribe = this.runtime.subscribe(this.wake);
    this.heartbeat = setInterval(this.tick, HEARTBEAT_MS);
    void this.connect();
  }
  stop() {
    this.attachments.stop();
    this.deviceSync.stop();
    this.delivery.stop();
    this.running = false;
    this.lifecycle++;
    this.generation++;
    this.connecting = false;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.disconnect();
    this.recent = [];
    this.directState.clear();
    this.profiles.clear();
    this.update({ messages: [], unread: 0, user: undefined, policy: { moderator: false, mutedUntil: null },
      status: this.session ? 'connecting' : 'signed-out', historyError: false, contactsSyncError: false,
      deviceSyncError: false,
      onlineCount: undefined,
      contacts: [], blocked: [], directAvailable: false, directResetAvailable: false,
      accountLookupAvailable: false, namesAvailable: false,
      notificationSettingsAvailable: false, mutedConversations: [],
      conversation: '', unreadByConversation: {} });
  }
  setViewing(viewing: boolean) { this.viewing = viewing; this.markRead(); }
  private canRead() { return this.viewing && this.runtime.isVisible(); }
  private allowDelivery(message: LoungeMessage) {
    if (!isCurrentDirect(message, peer => this.directState.generation(peer))) return false;
    if (message.conversation && !this.directState.ready(message.conversation)) return false;
    return message.delivery?.direction === 'incoming' ? !this.state.blocked.includes(message.sender.id)
      : !this.state.policy.mutedUntil || Date.parse(this.state.policy.mutedUntil) <= Date.now();
  }
  private markRead() {
    if (this.canRead()) this.delivery.read(this.state.messages);
    if (!this.canRead() || !this.state.unreadByConversation[this.state.conversation]) return;
    const unreadByConversation = { ...this.state.unreadByConversation, [this.state.conversation]: 0 };
    this.update({ unreadByConversation, unread: Object.values(unreadByConversation).reduce((sum, n) => sum + n, 0) });
  }
  private wake = () => {
    if (!this.running) return;
    this.deviceSync.retry();
    this.attachments.retryNow();
    this.markRead();
    if (this.socket && Date.now() - this.received > STALE_MS) this.disconnect();
    if (!this.socket) { clearTimeout(this.retry); void this.connect(); }
  };
  private tick = () => {
    if (!this.socket || !this.running) return;
    if (Date.now() - this.received > STALE_MS
      || this.renewalStarted && Date.now() - this.renewalStarted > AUTH_TIMEOUT_MS) {
      this.disconnect(); this.schedule(); return;
    }
    if (this.state.status !== 'connected') return;
    try { this.socket.send(JSON.stringify({ type: 'ping' })); } catch { this.disconnect(); this.schedule(); }
    if (Date.now() - this.authorized >= AUTH_RENEW_MS) void this.renew();
  };
  private schedule() {
    if (!this.running) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, this.backoff.next());
  }
  private async connect() {
    if (!this.running || !this.session || this.socket || this.connecting) return;
    this.connecting = true;
    const generation = ++this.generation;
    this.update({ status: 'connecting' });
    try {
      const credentials = await authorize(this.session);
      if (!this.running || generation !== this.generation) return;
      const url = new URL(`${this.session.baseUrl.replace(/\/+$/, '')}/lounge/socket`);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url.toString());
      this.socket = socket;
      this.received = Date.now();
      this.renewalStarted = Date.now();
      socket.onopen = () => {
        if (this.socket === socket) socket.send(JSON.stringify({
          type: 'authenticate', ticket: credentials.ticket, direct: true, receipts: true,
          groupAcks: true, avatarCache: true }));
      };
      socket.onmessage = event => { if (this.socket === socket) this.receive(event.data); };
      socket.onerror = () => { if (this.socket === socket) { this.disconnect(); this.schedule(); } };
      socket.onclose = () => { if (this.socket === socket) { this.disconnect(); this.schedule(); } };
    } catch { if (this.running && generation === this.generation) this.schedule(); }
    finally { if (generation === this.generation) this.connecting = false; }
  }
  private async renew() {
    if (this.renewing || !this.session || !this.socket) return;
    this.renewing = true;
    const socket = this.socket;
    try {
      const credentials = await authorize(this.session);
      if (socket !== this.socket || !this.running) return;
      socket.send(JSON.stringify({ type: 'authenticate', ticket: credentials.ticket,
        direct: true, receipts: true, groupAcks: true, avatarCache: true }));
      this.renewalStarted = Date.now();
    } catch { if (this.socket === socket) { this.disconnect(); this.schedule(); } }
    finally { this.renewing = false; }
  }
  private disconnect() {
    this.contactSync.disconnect();
    this.accountLookup.disconnect();
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onclose = socket.onmessage = socket.onopen = socket.onerror = null;
      socket.close();
    }
    this.renewalStarted = 0;
    this.submissions.disconnect();
    this.watched = '';
    this.profiles.disconnect();
    this.directState.disconnect();
    if (this.running) this.update({ status: 'connecting', onlineCount: undefined,
      contacts: this.state.contacts.map(contact => ({ ...contact, online: undefined })) });
  }
  private receive(data: unknown) {
    if (typeof data !== 'string' || data.length > MAX_FRAME_BYTES) return;
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(data) as Record<string, unknown>; } catch { return; }
    if (!frame || typeof frame !== 'object') return;
    this.received = Date.now();
    const notifications = notificationSettingsUpdate(this.state, frame);
    if (notifications) this.update(notifications);
    if (frame.type === 'accepted') {
      const message = this.submissions.accepted(frame);
      if (message && this.state.status === 'connected') this.append(message);
      return;
    }
    if (this.accountLookup.receive(frame)) return;
    if (this.contactSync.receive(frame)) return;
    if (frame.type === 'profiles') { this.receiveProfiles(frame.profiles); return; }
    if (frame.type === 'names') { this.receiveProfiles(frame, true); return; }
    if (frame.type === 'direct-permissions') { this.directState.receive(frame); return; }
    if (frame.type === 'rejected') this.delivery.reject(frame);
    if (frame.type === 'policy' || frame.type === 'ready') this.receivePolicy(frame.policy);
    if (['policy', 'ready', 'presence'].includes(String(frame.type)) && this.state.policy.moderator) {
      const count = frame.onlineCount;
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) this.update({ onlineCount: count });
    }
    if (frame.type === 'privacy' || frame.type === 'ready') this.contactSync.privacy(frame.blocked);
    if (frame.type === 'contacts') this.contactSync.presence(frame.contacts);
    if (frame.type === 'receipt' || frame.type === 'receipt-confirm') {
      this.delivery.receipt(frame); return;
    }
    if (frame.type === 'moderated' || frame.type === 'updated' || frame.type === 'rejected') {
      if (!this.submissions.has(String(frame.id))) return;
      if (frame.type === 'updated' && typeof frame.userId === 'string' && typeof frame.generation === 'number') {
        this.directState.receive({ states: { [frame.userId]: 'new' }, generations: { [frame.userId]: frame.generation } });
      }
      this.submissions.finish(String(frame.id), frame.type === 'rejected' ? new Error([
        'client.lounge.muted', 'client.lounge.directUnavailable',
        'client.lounge.awaitingReply', 'client.lounge.attachmentLimit'].includes(String(frame.code))
        ? String(frame.code) : 'client.lounge.actionFailed') : undefined);
      return;
    }
    if (frame.type === 'ready') {
      const user = frame.user as LoungeSnapshot['user'];
      if (!user || typeof user.id !== 'string' || typeof user.account !== 'string') return;
      this.authorized = Date.now(); this.backoff.reset(); this.renewalStarted = 0;
      this.attachments.ready(frame.attachments === true);
      this.profiles.ready(user, frame.profiles === true, frame.names === true, frame.avatarCache === true);
      this.directState.resetAvailable = frame.directReset === true;
      this.update({ status: 'connected', user, historyRevision: this.state.historyRevision + 1,
        attachmentsAvailable: frame.attachments === true,
        directAvailable: frame.direct === true && frame.receipts === true,
        accountLookupAvailable: frame.accountLookup === true,
        namesAvailable: frame.names === true,
        directResetAvailable: frame.directReset === true,
        contacts: this.state.contacts.filter(contact => contact.user.id !== user.id) });
      this.contactSync.ready(frame.savedContacts === true);
      this.deviceSync.ready(user.id, frame.deviceSync === true);
      this.syncWatch(); return;
    }
    const message = parseMessage(frame);
    if (!message || this.state.status !== 'connected') return;
    if (message.recipient && !this.directState.accept(message,
      messageConversation(message, this.state.user?.id ?? ''))) return;
    if (message.recipient && message.receipts) {
      const own = message.sender.id === this.state.user?.id;
      if (this.state.blocked.includes(message.sender.id) || !own && message.recipient.id !== this.state.user?.id) return;
      this.attachments.prefetch(message.attachments);
      this.delivery.receive({ ...message, delivery: undefined,
        conversation: messageConversation(message, this.state.user?.id ?? '') });
      return;
    }
    this.append(message);
  }
  private append(message: LoungeMessage) {
    const own = message.sender.id === this.state.user?.id;
    if (this.state.blocked.includes(message.sender.id)) return;
    if (message.recipient && !own && message.recipient.id !== this.state.user?.id) return;
    this.attachments.prefetch(message.attachments);
    const conversation = messageConversation(message, this.state.user?.id ?? '');
    message = { ...message, conversation: conversation || undefined };
    if (own) this.submissions.finish(message.id);
    if (this.recent.some(item => item.id === message.id && item.sender.id === message.sender.id)) return;
    this.recent = recentMessages([...this.recent, message]);
    const previous = this.state.messages.map(item => item.sender.id === message.sender.id
      ? { ...item, sender: message.sender } : item);
    const messages = conversation === this.state.conversation ? recentMessages([...previous, message]) : previous;
    const unreadByConversation = { ...this.state.unreadByConversation };
    if (!own && (!this.canRead() || conversation !== this.state.conversation)) {
      unreadByConversation[conversation] = (unreadByConversation[conversation] ?? 0) + 1;
    }
    this.update({ messages, unreadByConversation,
      unread: Object.values(unreadByConversation).reduce((sum, n) => sum + n, 0) });
    const user = own ? message.recipient : message.sender;
    if (user) this.contactSync.remember({ user, direct: !!message.recipient,
      ...(message.recipient ? { lastMessageAt: Date.parse(message.sentAt) } : {}) });
    this.archive(message);
  }
  private archive(message: LoungeMessage) {
    const store = this.session?.history;
    if (!store) return;
    const lifecycle = this.lifecycle;
    this.writes = this.writes.then(() => store.save(message)).then(() => {
      if (this.running && lifecycle === this.lifecycle) {
        this.deviceSync.changed(message);
        this.update({ historyRevision: this.state.historyRevision + 1 });
      }
    }).catch(() => {
      this.historyFailures++;
      if (this.running && lifecycle === this.lifecycle) this.update({ historyError: true });
    });
  }
  private async findMessage(key: string) {
    await this.writes;
    const memory = [...this.state.messages, ...this.recent].find(message => historyKey(message) === key);
    return await this.session?.history?.get?.(key) ?? memory;
  }
  retryDeviceSync() { this.deviceSync.retry(); }
  private restoreSynchronized(messages: LoungeMessage[]) {
    if (!this.running) return;
    const merged = synchronizedSnapshot(this.state, messages, this.recent);
    this.recent = merged.recent; this.update(merged.change);
    for (const message of messages) {
      const user = message.sender.id === this.state.user?.id ? message.recipient : message.sender;
      if (user) this.contactSync.remember({ user, direct: !!message.recipient,
        ...(message.recipient ? { lastMessageAt: Date.parse(message.sentAt) } : {}) });
    }
    this.markRead();
  }
  private async publishDirect(message: LoungeMessage, fresh: boolean) {
    if (!isCurrentDirect(message, peer => this.directState.generation(peer))) return;
    if (fresh) this.append(message);
    else {
      const replace = (previous: LoungeMessage) => historyKey(previous) === historyKey(message) ? message : previous;
      this.recent = this.recent.map(replace);
      this.update({ messages: this.state.messages.map(replace) }); this.archive(message);
    }
    await this.writes;
  }
  private async restoreHistory() {
    const store = this.session?.history;
    if (!store) return;
    const lifecycle = this.lifecycle;
    const conversation = this.state.conversation;
    const epoch = this.historyEpoch;
    try {
      const page = await store.page({ query: '', limit: RECENT_MESSAGE_LIMIT, conversation });
      if (!this.running || lifecycle !== this.lifecycle || conversation !== this.state.conversation
        || epoch !== this.historyEpoch) return;
      const restoredUser = this.state.user ?? page.messages.flatMap(message => [message.sender, message.recipient])
        .find(user => user && (this.session?.userId ? user.id === this.session.userId
          : user.account === this.session?.account));
      this.update({ user: restoredUser, messages: recentMessages([...page.messages.reverse(), ...this.state.messages]) });
      for (const message of page.messages) {
        if (message.sender.id !== this.state.user?.id) this.contactSync.remember({ user: message.sender,
          direct: !!message.recipient });
      }
      this.markRead();
      return true;
    } catch {
      if (this.running && lifecycle === this.lifecycle) this.update({ historyError: true });
    }
  }
  async searchHistory(query: HistoryQuery, options: { committedOnly?: boolean } = {}): Promise<HistoryPage> {
    query = { ...query, conversation: query.conversation ?? (query.pendingOnly ? undefined : this.state.conversation) };
    if (!options.committedOnly) await this.writes;
    if (this.session?.history) {
      const page = await this.session.history.page(query);
      return { ...page, messages: page.messages.map(this.profiles.message) };
    }
    const recent = recentMessages([...this.recent, ...this.state.messages]);
    const matches = searchLoungeHistory(recent, query.query).filter(message => {
      if (query.conversation !== undefined && (message.conversation ?? '') !== query.conversation) return false;
      if (query.pendingOnly && !needsDeliveryWork(message.delivery)) return false;
      const position = historyPosition(message);
      if (query.after && (position.time < query.after.time
        || position.time === query.after.time && position.key <= query.after.key)) return false;
      return !query.before || position.time < query.before.time
        || position.time === query.before.time && position.key < query.before.key;
    }).sort((a, b) => {
      const first = historyPosition(a); const second = historyPosition(b);
      const order = second.time - first.time || (first.key < second.key ? 1 : -1);
      return query.after ? -order : order;
    });
    return historyPage(matches.map(this.profiles.message), query);
  }
  async lookupMessage(reference: Pick<LoungeReply, 'id' | 'senderId'>, conversation = this.state.conversation) {
    const key = JSON.stringify([reference.senderId, reference.id]);
    const message = [...this.state.messages, ...this.recent].find(item => historyKey(item) === key)
      ?? await this.session?.history?.get?.(key);
    return message && (message.conversation ?? '') === conversation ? this.profiles.message(message) : undefined;
  }
  async retryHistory() {
    await this.writes;
    const lifecycle = this.lifecycle;
    const failures = this.historyFailures;
    for (const message of recentMessages([...this.recent, ...this.state.messages])) this.archive(message);
    for (const contact of this.state.contacts) this.persistContact(contact);
    await this.writes;
    const restored = await this.restoreHistory();
    if (restored && this.running && lifecycle === this.lifecycle && failures === this.historyFailures) {
      this.update({ historyError: false });
    }
  }
  async send(draft: LoungeDraft): Promise<void> {
    if (draft.to && !this.state.directAvailable) return Promise.reject(new Error('client.lounge.directUnavailable'));
    if (this.state.policy.mutedUntil && Date.parse(this.state.policy.mutedUntil) > Date.now()) {
      return Promise.reject(new Error('client.lounge.muted'));
    }
    const lifecycle = this.lifecycle;
    draft = this.attachments.prepare(draft);
    if (draft.attachments?.some(file => file.kind === 'image')) await this.attachments.persistImages(draft.attachments);
    if (lifecycle !== this.lifecycle) throw new Error('client.lounge.sendFailed');
    if (draft.to) {
      const recipient = this.state.contacts.find(contact => contact.user.id === draft.to)?.user;
      if (!recipient) return Promise.reject(new Error('client.lounge.directUnavailable'));
      return this.delivery.send(draft, this.runtime.randomId(), recipient);
    }
    return this.submit({ type: 'message', ...draft }, draft);
  }
  async setAvatar(avatar: string): Promise<void> {
    if (!this.state.user || !this.profiles.available) throw new Error('client.lounge.avatarSaveFailed');
    if (avatar && !avatarData(avatar)) throw new Error('client.lounge.imageFailed');
    try { await this.submit({ type: 'avatar', avatar }); }
    catch { throw new Error('client.lounge.avatarSaveFailed'); }
  }
  setName(options: { kind: 'nickname' | 'remark'; userId: string; value: string }) {
    return this.profiles.names.save(options, frame => this.submit(frame));
  }
  private receiveProfiles(input: unknown, names = false) {
    if (!(names ? this.profiles.names.receive(input as Record<string, unknown>) : this.profiles.receive(input))) return;
    this.recent = this.recent.map(this.profiles.message);
    const previous = this.state.contacts;
    this.update({ historyRevision: this.state.historyRevision + 1 });
    this.state.contacts.forEach((contact, index) => {
      if (contact.user !== previous[index]?.user) this.persistContact(contact);
    });
  }
  moderate(userId: string, minutes: number): Promise<void> {
    return this.submit({ type: 'moderate', userId, minutes });
  }
  selectConversation(user?: LoungeSnapshot['user']) {
    const conversation = user?.id ?? '';
    if (user && user.id !== this.state.user?.id) this.contactSync.remember({ user, direct: true });
    if (conversation === this.state.conversation) return;
    this.update({ conversation, messages: this.recent.filter(message => (message.conversation ?? '') === conversation) });
    this.markRead(); this.syncWatch(); void this.restoreHistory();
  }
  block(userId: string, blocked: boolean) { return this.submit({ type: 'block', userId, blocked }); }
  async setNotificationsMuted(conversation: string, muted: boolean) {
    if (!this.state.notificationSettingsAvailable) throw new Error('client.lounge.notificationSaveFailed');
    try { await this.submit({ type: 'notification-setting', conversation, muted }); }
    catch { throw new Error('client.lounge.notificationSaveFailed'); }
  }
  setPinned(userId: string, pinned: boolean) {
    const contact = this.state.contacts.find(value => value.direct && value.user.id === userId);
    if (!contact || contact.pinned === pinned) return;
    this.contactSync.remember({ ...contact, pinned });
  }
  async deleteContact(userId: string) {
    const store = this.session?.history;
    if (!this.state.directResetAvailable || !userId || userId === this.state.user?.id
      || store && !store.deleteConversation) throw new Error('client.lounge.deleteFailed');
    const lifecycle = this.lifecycle;
    const previousGeneration = this.directState.generation(userId);
    await this.submit({ type: 'delete-direct', userId });
    const generation = this.directState.generation(userId);
    if (generation <= previousGeneration) throw new Error('client.lounge.deleteFailed');
    await this.delivery.remove(userId, async () => {
      await this.writes;
      if (lifecycle !== this.lifecycle) throw new Error('client.lounge.deleteFailed');
      await store?.deleteConversation?.(userId, generation);
      this.historyEpoch++;
      const removed = removedConversation({ state: this.state, peer: userId, generation, recent: this.recent });
      this.recent = removed.recent; this.update(removed.snapshot); this.syncWatch();
    });
  }
  retryContacts() { this.contactSync.retry(); }
  private persistContact(stored: LoungeContact) {
    const lifecycle = this.lifecycle;
    if (this.session?.history?.saveContact) this.writes = this.writes
      .then(() => this.session!.history!.saveContact!(stored))
      .catch(() => {
        this.historyFailures++;
        if (this.running && lifecycle === this.lifecycle) this.update({ historyError: true });
      });
  }
  private async restoreContacts() {
    if (!this.session?.history?.contacts) return;
    const lifecycle = this.lifecycle;
    const epoch = this.historyEpoch;
    try {
      const stored = await this.session.history.contacts();
      if (!this.running || lifecycle !== this.lifecycle || epoch !== this.historyEpoch) return;
      const contacts = this.state.contacts.reduce(mergeContact, stored)
        .filter(contact => contact.user.id !== this.state.user?.id && contact.user.account !== this.session?.account);
      this.update({ contacts }); this.syncWatch();
    } catch { if (this.running && lifecycle === this.lifecycle) this.update({ historyError: true }); }
  }
  private syncWatch() {
    if (this.state.status !== 'connected' || !this.socket) return;
    try { this.profiles.watch(this.socket, this.state); }
    catch { this.disconnect(); this.schedule(); return; }
    if (!this.state.directAvailable) return;
    const ids = this.state.contacts.filter(contact => contact.direct).map(contact => contact.user.id);
    const watch = [...new Set([this.state.conversation, ...this.delivery.peers(), ...ids.reverse()].filter(Boolean))]
      .slice(0, 200);
    const serialized = JSON.stringify(watch);
    if (serialized === this.watched) return;
    try { this.socket.send(JSON.stringify({ type: 'watch', watch })); this.watched = serialized; }
    catch { this.disconnect(); this.schedule(); }
  }
  private receivePolicy(input: unknown) {
    if (!input || typeof input !== 'object') return;
    const value = input as Record<string, unknown>;
    if (typeof value.moderator !== 'boolean' || value.mutedUntil !== null &&
      (typeof value.mutedUntil !== 'string' || !Number.isFinite(Date.parse(value.mutedUntil)))) return;
    this.update({ policy: { moderator: value.moderator, mutedUntil: value.mutedUntil as string | null },
      user: this.state.user ? { ...this.state.user, moderator: value.moderator } : undefined,
      onlineCount: value.moderator ? this.state.onlineCount : undefined });
  }
  private submit(frame: Record<string, unknown>, draft?: LoungeDraft): Promise<void> {
    const socket = this.socket;
    if (this.state.status !== 'connected' || !socket) return Promise.reject(new Error('client.lounge.sendFailed'));
    const id = this.runtime.randomId();
    return this.submissions.send({ socket, id, frame,
      group: draft && this.state.user ? { draft, sender: this.state.user } : undefined });
  }
}
