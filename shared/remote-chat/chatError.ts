const THREAD_PREPARING = '对话正在准备，请稍后重试。';

/** A conversation's brief preparation state does not need an error notice. */
export function visibleChatError(error: string) {
  return error === THREAD_PREPARING ? '' : error;
}
