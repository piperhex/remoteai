interface StatusSession {
  status: string;
  waitingForPermission: boolean;
  retry: () => void;
  togglePrivacy: () => Promise<void>;
}

export const PRIVACY_SETUP_MESSAGES = [
  '请在电脑上确认安装，完成后再点一次隐私屏。',
  '请先解锁电脑，再点隐私屏确认安装。',
] as const;

/** Setup leaves capture connected, so its retry must not tear down the current desktop. */
export function desktopStatusAction(session: StatusSession) {
  if (PRIVACY_SETUP_MESSAGES.some(message => message === session.status)) {
    return { label: '重试隐私屏', run: () => { void session.togglePrivacy(); } };
  }
  return { label: session.waitingForPermission ? '检查授权' : '重新连接', run: session.retry };
}
