import { hasLocalBackend, invoke, loadProxySessionRequests } from './backend';
import type { ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import { summarizeProxyRequests } from '../utils/proxyConversationMetrics';

export const loadConversationMetrics: ReadConversationMetrics = async (threadId) => {
  if (!hasLocalBackend) return summarizeProxyRequests(await loadProxySessionRequests(threadId));
  return invoke('get_proxy_session_metrics', { threadId });
};
