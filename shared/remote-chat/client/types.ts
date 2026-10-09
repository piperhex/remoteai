export type {
  AccessMode, ApprovalReply, GuiEvent, Item, ListResponse, Model, Request,
  Skill, SkillReference, SkillsResponse, Thread, ThreadTokenUsage, Turn,
} from '../../../apps/desktop/src/pages/codexGui/types';
import type { GuiEvent, Model, SkillReference, Thread } from '../../../apps/desktop/src/pages/codexGui/types';
import type { AttachmentReference } from '../../../apps/desktop/src/pages/codexGui/attachmentTypes';
import type { ConnectionMode } from '../protocol';
import { DEFAULT_COMPOSER, type ComposerSettings } from '../composer';
import { emptySidebar, type SidebarSnapshot } from '../sidebar';
import { emptyQueue, type QueueSnapshot } from '../queue';

export interface SendInput {
  goalMode?: boolean;
  text: string;
  images?: string[];
  skills?: SkillReference[];
  attachments?: AttachmentReference[];
  model?: string;
  effort?: string;
  access: ComposerSettings['access'];
}

export interface ChatProject { cwd: string; label: string }

export interface ChatState {
  directEndpoints?: import('../connectionEndpoints').ConnectionEndpoints;
  publicEndpoints?: import('../publicEndpoints').ConnectionPublicEndpoints;
  connectionStage?: import('../connectionHealth').ConnectionStage;
  connectionIssue?: string;
  deliveries?: Record<string, import('../taskDelivery').TaskDelivery>;
  notificationError?: boolean;
  desktopOnly?: boolean;
  upload?: import('../uploadProgress').UploadProgress;
  processing?: import('../../../apps/desktop/src/pages/codexGui/processing').ProcessingState;
  cachedThreadIds?: string[];
  historyOffline?: boolean;
  cacheError?: string;
  goals?: Record<string, import('../../../apps/desktop/src/pages/codexGui/goalTypes').ThreadGoal | null>;
  goalBusy?: boolean;
  mode: ConnectionMode;
  ready: boolean;
  connecting: boolean;
  retryAt: number | null;
  threads: Thread[];
  selected: Thread | null;
  draftProject: ChatProject | null;
  selectedArchived: boolean;
  models: Model[];
  settings: ComposerSettings;
  settingsBusy: boolean;
  settingsError: string;
  sidebar: SidebarSnapshot;
  queue: QueueSnapshot;
  queueBusy: boolean;
  approvals: GuiEvent[];
  cursor: string | null;
  search: string;
  archived: boolean;
  loading: boolean;
  historyLoading: boolean;
  historyLoadingMore: boolean;
  historyHasMore: boolean;
  sending: boolean;
  workspaceBusy?: boolean;
  threadActionBusy?: string;
  compacting?: string;
  error: string;
}

export function initialChatState(): ChatState {
  return { mode: 'offline', ready: false, connecting: false, retryAt: null,
    threads: [], selected: null, draftProject: null, selectedArchived: false,
    models: [], approvals: [], cursor: null, queue: emptyQueue(), queueBusy: false,
    settings: { ...DEFAULT_COMPOSER }, settingsBusy: false, settingsError: '', sidebar: emptySidebar(),
    search: '', archived: false, loading: false, historyLoading: false, historyLoadingMore: false,
    historyHasMore: false, sending: false, error: '' };
}
