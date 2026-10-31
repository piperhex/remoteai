import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LoungeController } from './controller';
import type { LoungeAccount, LoungeDraft, LoungeMessage } from './types';
import { quoteMessage, type LoungeReply } from './reply';
import { useLoungeNavigation } from './useLoungeNavigation';
import { useLoungeNotificationSettings } from './useLoungeNotificationSettings';

export type LoungeSheet = 'members' | 'about' | 'extras' | 'new-chat' | undefined;
const EMPTY_DRAFT: LoungeDraft = { text: '', images: [] };
const READ_RECEIPT_BOTTOM_DISTANCE = 48;
export const LOUNGE_SCROLL_EDGE_TOLERANCE = 1;

/** Page-local navigation and drafts shared by native and mobile web. */
export function useMobileLounge(controller: LoungeController) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const notifications = useLoungeNotificationSettings(controller);
  const navigation = useLoungeNavigation(controller, state);
  const [chats, setChats] = useState(true);
  const [sheet, setSheet] = useState<LoungeSheet>();
  const [drafts, setDrafts] = useState<Record<string, LoungeDraft>>({});
  const offsets = useRef(new Map<string, number>());
  const scrollPositions = useRef(new Map<string, number>());
  const [history, setHistory] = useState(false);
  const [avatar, setAvatar] = useState(false);
  const [preview, setPreview] = useState<string>();
  const [moderating, setModerating] = useState<LoungeAccount>();
  const [blocking, setBlocking] = useState<LoungeAccount>();
  const [profileUser, setProfile] = useState<LoungeAccount>();
  const profile = profileUser && (profileUser.id === state.user?.id ? state.user
    : state.contacts.find(value => value.user.id === profileUser.id)?.user ?? profileUser);
  const [deleting, changeDeleting] = useState<LoungeAccount>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const setDeleting = (user?: LoungeAccount) => { setDeleteError(false); changeDeleting(user); };
  const [composerOverlay, setComposerOverlay] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [following, setFollowing] = useState(true);
  const [showLatest, setShowLatest] = useState(false);
  const [now, setNow] = useState(Date.now);
  const muted = !!state.policy.mutedUntil && Date.parse(state.policy.mutedUntil) > now;
  const conversation = state.conversation;
  const updateScrollPosition = useCallback((offset: number, viewportHeight: number) => {
    offsets.current.set(conversation, Math.max(0, offset));
    setAtBottom(!navigation.focus && offset < READ_RECEIPT_BOTTOM_DISTANCE);
    setFollowing(!navigation.focus && offset <= LOUNGE_SCROLL_EDGE_TOLERANCE);
    // Following new messages and offering a one-page shortcut have different thresholds.
    setShowLatest(viewportHeight > 0 && offset >= viewportHeight);
  }, [conversation, navigation.focus]);
  const change = (draft: LoungeDraft) => setDrafts(current => ({ ...current, [conversation]: draft }));
  const draft = drafts[conversation] ?? EMPTY_DRAFT;
  const contact = state.contacts.find(value => value.user.id === conversation);
  const select = (user?: LoungeAccount) => {
    navigation.clear();
    controller.setViewing(false);
    controller.selectConversation(user);
    setAtBottom((offsets.current.get(user?.id ?? '') ?? 0) < READ_RECEIPT_BOTTOM_DISTANCE);
    setFollowing((offsets.current.get(user?.id ?? '') ?? 0) <= LOUNGE_SCROLL_EDGE_TOLERANCE);
    setShowLatest(false);
    setSheet(undefined); setChats(false); setProfile(undefined); setHistory(false);
  };
  const deleteContact = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true); setDeleteError(false);
    try {
      await controller.deleteContact(deleting.id);
      setDrafts(current => { const updated = { ...current }; delete updated[deleting.id]; return updated; });
      offsets.current.delete(deleting.id); scrollPositions.current.delete(deleting.id);
      setProfile(undefined); setSheet(undefined); setHistory(false); setChats(true); setDeleting(undefined);
    } catch { setDeleteError(true); }
    finally { setDeleteBusy(false); }
  };
  const quote = (message: LoungeMessage) => { change({ ...draft, reply: quoteMessage(message) }); setHistory(false); };
  const locate = async (reference: LoungeReply) => {
    if (!await navigation.locate(reference)) return;
    setHistory(false); setChats(false); setSheet(undefined); setAtBottom(false); setFollowing(false);
  };
  const latest = () => { navigation.clear(); setAtBottom(true); setFollowing(true); setShowLatest(false); };
  const cancelReply = () => change({ ...draft, reply: undefined });
  useEffect(() => {
    controller.setViewing(atBottom && !chats && !sheet && !history && !avatar && !preview
      && !moderating && !blocking && !profile && !deleting && !composerOverlay && !navigation.focus);
    return () => controller.setViewing(false);
  }, [controller, atBottom, chats, sheet, history, avatar, preview, moderating, blocking,
    profile, deleting, composerOverlay, conversation, navigation.focus]);
  useEffect(() => {
    if (!muted) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [muted]);
  return { state, notifications, contact, chats, setChats, sheet, setSheet, drafts, draftState: { draft, change },
    offsets, scrollPositions, history, setHistory, avatar, setAvatar, preview, setPreview, moderating, setModerating,
    blocking, setBlocking, profile, setProfile, deleting, setDeleting, deleteBusy, deleteError, deleteContact,
    atBottom, setAtBottom, following, showLatest, updateScrollPosition,
    muted, select, quote, cancelReply, setComposerOverlay, navigation, locate, latest };
}

export type MobileLounge = ReturnType<typeof useMobileLounge>;
