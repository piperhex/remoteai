import { diagnosticError } from '../remote-chat/iceCandidate';
import { PRIVACY_SETUP_MESSAGES } from './statusAction';
import type { DiagnosticFields } from '../remote-chat/diagnostics';

type DesktopErrorCode = NonNullable<DiagnosticFields['desktopError']>;
type Reason = NonNullable<DiagnosticFields['reason']>;

// Native IPC and older hosts return display-safe messages. Match complete, known messages only;
// arbitrary error text, paths and credentials must never become diagnostic fields.
const ERRORS: ReadonlyArray<readonly [DesktopErrorCode, Reason, readonly string[]]> = [
  ['privacy-unavailable', 'unavailable', ['隐私屏未能切换，请重新连接后重试。',
    ...PRIVACY_SETUP_MESSAGES,
    '请先在电脑的远程设置中开启无人值守，再使用隐私屏。']],
  ['screen-permission', 'permission', ['请在 Mac 的远程设置中开启屏幕录制权限，然后重新连接。']],
  ['accessibility-permission', 'permission', ['请在 Mac 的远程设置中开启辅助功能权限，然后重新连接。']],
  ['desktop-disabled', 'permission', ['这台电脑未允许此远程操作，请在电脑的设置中调整。']],
  ['macos-version', 'unsupported', ['远程桌面需要 macOS 13 或更新版本。']],
  ['platform-unsupported', 'unsupported', ['这台电脑暂不支持远程桌面，请使用 Windows 或 Mac 电脑。']],
  ['runtime-unavailable', 'unavailable', ['远程桌面暂不可用，请更新电脑端应用后重试。']],
  ['settings-unavailable', 'unavailable', ['远程桌面设置未能读取，请在电脑端重新打开远程设置。']],
  ['no-displays', 'unavailable', ['未找到可用显示器，请确认电脑已连接显示器并登录桌面。']],
  ['display-enumeration', 'operation-failed', ['未能读取显示器信息，请在电脑端重新连接显示器后重试。']],
  ['display-unavailable', 'unavailable', ['显示器已断开，请重新连接桌面。']],
  ['desktop-busy', 'busy', ['已有远程桌面连接，请先关闭后再试。']],
  ['lease-expired', 'invalid-state', ['桌面连接已结束，请重新连接。', '桌面连接已结束。']],
  ['invalid-request', 'invalid-description', ['远程操作无效，请重试。', '桌面连接信息无效，请重新连接。']],
  ['capture-failed', 'operation-failed', ['暂时无法访问桌面，请稍后重试。', '暂时无法读取屏幕画面。']],
  ['encoder-start', 'operation-failed', ['未能启动屏幕共享，请重新打开电脑端应用后重试。']],
  ['encoder-first-frame', 'operation-failed', ['未能获取屏幕画面，请确认电脑已登录桌面后重试。']],
  ['encoder-timeout', 'timeout', ['获取屏幕画面超时，请重新连接。']],
  ['codec-unsupported', 'unsupported', ['暂时无法共享屏幕，请更新两端应用后重试。']],
];

/** Classify both Tauri string rejections and the Error restored by the encrypted desktop RPC. */
export function desktopFailure(error: unknown): DiagnosticFields {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : undefined;
  const match = ERRORS.find(([, , messages]) => message !== undefined && messages.includes(message));
  return match ? { desktopError: match[0], reason: match[1] }
    : { desktopError: 'unknown', reason: diagnosticError(error) };
}
