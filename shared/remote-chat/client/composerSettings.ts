import { COMPOSER_FIELDS, DEFAULT_COMPOSER, MODEL_CATALOG_ERROR, composerPatch, type ComposerModelsResponse,
  type ComposerSettings, type ComposerSnapshot } from '../composer';
import { resolveModelSelection } from '../../../apps/desktop/src/pages/codexGui/modelSelection';
import type { ChatState } from './types';

interface Host {
  snapshot: () => ChatState;
  update: (patch: Partial<ChatState>) => void;
  ready: () => boolean;
  request: <T>(body: Record<string, unknown>) => Promise<T>;
}
interface Entry {
  remote?: ComposerSnapshot;
  pending: Partial<ComposerSettings>;
  saving?: Promise<void>;
  reading?: Promise<void>;
  failed: string;
  catalogUnavailable: boolean;
}
const SAVE_ERROR = '设置尚未保存，请重试。';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : SAVE_ERROR;

/** Retains edits in their original conversation, including across navigation and reconnects. */
export class RemoteComposerSettings {
  private scoped = false;
  private generation = 0;
  private entries = new Map<string | null, Entry>();
  constructor(private readonly host: Host) {}

  private scope() { return this.scoped ? this.host.snapshot().selected?.id ?? null : null; }
  private entry(threadId: string | null) {
    let entry = this.entries.get(threadId);
    if (!entry) {
      entry = { pending: {}, failed: '', catalogUnavailable: false };
      this.entries.set(threadId, entry);
    }
    return entry;
  }

  reset() {
    this.generation++;
    for (const entry of this.entries.values()) {
      if (entry.remote) entry.remote = { ...entry.remote, revision: -1 };
      entry.reading = undefined;
    }
  }

  private show() {
    const entry = this.entry(this.scope());
    this.host.update({ ...(entry.remote ? { models: entry.remote.models } : {}),
      settings: { ...(entry.remote?.settings ?? DEFAULT_COMPOSER), ...entry.pending },
      settingsBusy: Boolean(entry.remote?.syncing || entry.reading || entry.saving || entry.failed
        || entry.catalogUnavailable || Object.keys(entry.pending).length || (this.scoped && !entry.remote)),
      settingsError: entry.failed || (entry.catalogUnavailable ? MODEL_CATALOG_ERROR : '') });
  }

  receive(snapshot: ComposerSnapshot) {
    if (!snapshot || !Array.isArray(snapshot.models) || !snapshot.settings
      || !Number.isSafeInteger(snapshot.revision)) return;
    if (this.scoped && snapshot.threadId === undefined) return;
    if (!this.scoped && snapshot.threadId !== undefined) return;
    const id = this.scoped ? snapshot.threadId! : null;
    const entry = this.entry(id);
    if (snapshot.revision < (entry.remote?.revision ?? -1)) return;
    const wasSyncing = entry.remote?.syncing;
    entry.catalogUnavailable = !snapshot.models.length;
    // Older hosts may publish empty results as success. Keep the display, but wait for a valid catalog before saving.
    entry.remote = entry.catalogUnavailable && entry.remote?.models.length
      ? { ...snapshot, models: entry.remote.models, settings: entry.remote.settings } : snapshot;
    if (id === this.scope()) this.show();
    if (!entry.catalogUnavailable && (wasSyncing || Object.keys(entry.pending).length)) {
      queueMicrotask(() => this.flush());
    }
  }

  async load(): Promise<void> {
    const threadId = this.host.snapshot().selected?.id ?? null;
    const entry = this.entry(this.scope());
    if (entry.reading) return entry.reading;
    const generation = this.generation;
    const reading = this.read(threadId, generation).catch((error: unknown) => {
      if (generation === this.generation) entry.failed = errorMessage(error);
      throw error;
    }).finally(() => {
      if (entry.reading === reading) entry.reading = undefined;
      if (generation === this.generation) { this.show(); this.flush(); }
    });
    entry.reading = reading;
    this.show();
    return reading;
  }

  private async read(threadId: string | null, generation: number) {
    const result = await this.host.request<ComposerModelsResponse>({ operation: 'models', threadId });
    if (generation !== this.generation) return;
    const wasScoped = this.scoped;
    if (result.composer) {
      if (result.composer.threadId !== undefined) {
        if (result.composer.threadId !== threadId) throw new Error('聊天设置尚未同步，请重试。');
        this.scoped = true;
      }
      this.receive(result.composer);
    } else {
      const selection = resolveModelSelection(result.data, DEFAULT_COMPOSER);
      this.receive({ models: result.data, revision: 0,
        settings: { ...this.host.snapshot().settings, ...selection } });
    }
    this.entry(this.scoped ? threadId : null).failed = '';
    // Navigation can finish before the initial host-capability response arrives.
    if (!wasScoped && this.scoped && threadId !== (this.host.snapshot().selected?.id ?? null)) void this.select();
  }

  select(inherit?: Pick<ComposerSettings, 'model' | 'effort' | 'access'>): Promise<void> {
    if (!this.scoped) return Promise.resolve();
    if (inherit) this.set(inherit);
    this.show();
    return this.load().catch(() => { /* The settings panel displays the failed read and blocks sending. */ });
  }

  set(input: Partial<ComposerSettings>) {
    const patch = composerPatch(input);
    if (!Object.keys(patch).length) return;
    const state = this.host.snapshot();
    if (patch.model && patch.model !== state.settings.model) {
      patch.effort = resolveModelSelection(state.models, { model: patch.model, effort: patch.effort ?? '' }).effort;
    }
    const entry = this.entry(this.scope());
    entry.pending = { ...entry.pending, ...patch };
    entry.failed = '';
    this.show();
    if (entry.catalogUnavailable) {
      void this.load().catch(() => { /* The failed read is shown by the settings panel. */ });
      return;
    }
    this.flush();
  }

  flush() {
    for (const [id, entry] of this.entries) {
      if (!entry.failed) void this.save(id);
    }
  }

  private async save(id: string | null): Promise<void> {
    const entry = this.entry(id);
    if (entry.saving) return entry.saving;
    if (!this.host.ready() || entry.reading || entry.remote?.syncing || entry.catalogUnavailable
      || !Object.keys(entry.pending).length) return;
    const generation = this.generation;
    const patch = { ...entry.pending };
    const saving = this.write({ id, patch, generation }).catch((error: unknown) => {
      if (generation === this.generation) entry.failed = errorMessage(error);
    }).finally(() => {
      if (entry.saving === saving) entry.saving = undefined;
      if (generation === this.generation) this.show();
      if (!entry.failed) this.flush();
    });
    entry.saving = saving;
    if (id === this.scope()) this.show();
    return saving;
  }

  private async write({ id, patch, generation }: {
    id: string | null; patch: Partial<ComposerSettings>; generation: number;
  }) {
    const snapshot = await this.host.request<ComposerSnapshot>({ operation: 'composerSet', settings: patch,
      ...(this.scoped ? { threadId: id } : {}) });
    if (generation !== this.generation) return;
    if (!snapshot?.settings || !Array.isArray(snapshot.models) || !snapshot.models.length
      || !Number.isSafeInteger(snapshot.revision)
      || (this.scoped && snapshot.threadId !== id)) throw new Error('电脑尚未确认设置，请重试。');
    const entry = this.entry(id);
    for (const field of COMPOSER_FIELDS) {
      if (patch[field] !== undefined && entry.pending[field] === patch[field]) delete entry.pending[field];
    }
    this.receive(snapshot);
  }

  /** Save a phone-created thread before its first turn; PC navigation can then restore the same choice. */
  async created(threadId: string, settings: ComposerSettings) {
    if (!this.scoped) return;
    const entry = this.entry(threadId);
    entry.remote = { threadId, settings, models: this.host.snapshot().models, revision: -1 };
    entry.pending = { model: settings.model, effort: settings.effort, access: settings.access };
    await this.save(threadId);
    if (Object.keys(entry.pending).length) throw new Error(entry.failed || SAVE_ERROR);
  }

  retry() {
    for (const entry of this.entries.values()) entry.failed = '';
    this.flush();
  }
}
