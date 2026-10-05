import { DEFAULT_TITLE_SETTINGS, parseTitleSettings, type TitleSettings } from './titleSettings';

// Defaults are fallback durations, not upper bounds; administrators may choose larger values.
export const P2P_POLICY_FIELDS = {
  p2pNegotiationTimeoutSeconds: { min: 1, max: undefined, default: 45 },
  p2pRetryIntervalSeconds: { min: 1, max: undefined, default: 10 },
  p2pDisconnectGraceSeconds: { min: 1, max: undefined, default: 10 },
} as const;

/** Public numeric contract shared by the admin form, chat clients and desktop host. */
export const CHAT_POLICY_FIELDS = {
  chatSessionLimit: { min: 1, max: undefined, default: 5 },
  ...P2P_POLICY_FIELDS,
  relayHeartbeatTimeoutSeconds: { min: 1, max: undefined, default: 30 },
  relayMaxMbPerSecond: { min: -1, max: undefined, default: -1 },
  relayMaxFramesPerSecond: { min: -1, max: undefined, default: -1 },
  threadPageSize: { min: 1, max: undefined, default: 50 },
  historyPageSize: { min: 1, max: undefined, default: 10 },
  imageSourceMaxMb: { min: 1, max: undefined, default: 20 },
  imageMaxEdge: { min: 256, max: undefined, default: 2048 },
  imageTargetKb: { min: 32, max: undefined, default: 512 },
  fileUploadMaxMb: { min: 1, max: undefined, default: 2 },
  fileUploadTotalMaxMb: { min: 1, max: undefined, default: 3 },
  filePreviewMaxMb: { min: 1, max: undefined, default: 2 },
  imagePreviewMaxMb: { min: 1, max: undefined, default: 20 },
  videoPreviewMaxMb: { min: 1, max: undefined, default: 100 },
  fileDownloadMaxMb: { min: 1, max: undefined, default: 20 },
  // Two active downloads leave eight of the 32 RPC slots available for chat and other actions.
  fileDownloadWindowSize: { min: 1, max: 12, default: 5 },
} as const;

export type NumericChatPolicy = { [K in keyof typeof CHAT_POLICY_FIELDS]: number };
export type ChatPolicy = NumericChatPolicy & { titleSettings: TitleSettings };
export const DEFAULT_CHAT_POLICY: ChatPolicy = {
  ...Object.fromEntries(Object.entries(CHAT_POLICY_FIELDS)
    .map(([key, field]) => [key, field.default])) as NumericChatPolicy,
  titleSettings: DEFAULT_TITLE_SETTINGS,
};

export function parseChatPolicy(value: unknown): ChatPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请填写完整的聊天设置。');
  const record = value as Record<string, unknown>;
  const policy = { ...DEFAULT_CHAT_POLICY };
  for (const key of Object.keys(CHAT_POLICY_FIELDS) as (keyof NumericChatPolicy)[]) {
    const field = CHAT_POLICY_FIELDS[key];
    // Older saved policies and coordinators do not include these later additions.
    const optional = field.default === -1 || key === 'videoPreviewMaxMb'
      || key === 'fileUploadMaxMb' || key === 'fileUploadTotalMaxMb' || key === 'chatSessionLimit'
      || key === 'relayHeartbeatTimeoutSeconds' || key === 'fileDownloadWindowSize' || key in P2P_POLICY_FIELDS;
    const number = optional && record[key] === undefined ? field.default : record[key];
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < field.min
      || (field.default === -1 && number === 0) || (field.max !== undefined && number > field.max)) {
      throw new Error('请在允许范围内填写整数。');
    }
    policy[key] = number;
  }
  policy.titleSettings = parseTitleSettings(record.titleSettings);
  return policy;
}
