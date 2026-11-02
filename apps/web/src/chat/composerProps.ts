import type { ReactNode } from 'react';
import type { PromptSuggestionSource } from '../../../../shared/chat/nextPromptSuggestion';
import type { Model, SendInput, ThreadTokenUsage } from './types';
import type { ChatConnectionProps } from './ChatProfileMenu';
import type { ComposerSettings } from '../../../../shared/remote-chat/composer';
import type { ReadUsage } from '../../../../shared/remote-chat/usage';
import type { ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import type { ContextSettingsApi } from '../../../../shared/remote-chat/contextSettings';
import type { QueueProps } from '../../../../shared/remote-chat/client/queueProps';
import type { UploadProgress } from '../../../../shared/remote-chat/uploadProgress';
import type { RemoteGoals } from '../../../../shared/remote-chat/client/goals';
import type { ThreadGoal } from '../../../desktop/src/pages/codexGui/goalTypes';
import type { SkillCatalogState } from '../../../../shared/chat/skillCatalog';
import type { RemoteComposerCatalog } from '../../../../shared/remote-chat/composerCatalog';
import type { ProjectFilesRequest, ProjectFilesResponse } from '../../../../shared/remote-chat/projectFiles';
import type { ConversationSearch } from '../../../../shared/chat/useConversationCandidates';
import type { SubscribeFileDrop } from '../../../../shared/chat/useFileDrop';

export interface NativeFileDrop {
  subscribe: SubscribeFileDrop;
  readFiles: (paths: string[]) => Promise<File[]>;
}

export interface ComposerProps {
  dictation?: import('../../../../shared/chat/dictation/client').DictationClient;
  recoveredEdit?: import('../../../../shared/remote-chat/queue').QueueDraft;
  consumeRecoveredEdit?: () => void;
  projectPicker?: ReactNode;
  connectionInfo?: ReactNode;
  cliVersion?: string | null;
  readServiceStatus?: import('../../../../shared/codex-status/status').ReadCodexServiceStatus;
  serviceStatusConnected?: boolean;
  suggestions?: PromptSuggestionSource;
  connection: ChatConnectionProps;
  readClipboardImages?: () => Promise<File[]>;
  nativeFileDrop?: NativeFileDrop;
  uploadProgress?: UploadProgress;
  queue?: QueueProps;
  tokenUsage?: ThreadTokenUsage;
  readUsage: ReadUsage;
  readConversationMetrics: ReadConversationMetrics;
  contextSettings: ContextSettingsApi;
  models: Model[];
  selection: ComposerSettings;
  settingsBusy: boolean;
  settingsError: string;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  refreshModels: () => Promise<void>;
  threadId: string | null;
  active: boolean;
  ready: boolean;
  sending: boolean;
  running: boolean;
  interrupted?: boolean;
  send: (input: SendInput) => Promise<boolean>;
  interrupt: () => Promise<void>;
  goals: Pick<RemoteGoals, 'load' | 'clear'>;
  goal?: ThreadGoal | null;
  goalBusy: boolean;
  catalog: SkillCatalogState & { refresh: () => void };
  cwd: string;
  compactReason: string | null;
  compacting: boolean;
  compact: () => Promise<boolean>;
  loadCatalog: (cwd: string) => Promise<RemoteComposerCatalog>;
  loadFiles: (options: ProjectFilesRequest) => Promise<ProjectFilesResponse>;
  loadConversations: ConversationSearch;
}
