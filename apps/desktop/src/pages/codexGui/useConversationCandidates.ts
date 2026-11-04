import { useConversationCandidates as useCandidates,
  type ConversationSearch } from "../../../../../shared/chat/useConversationCandidates";
import { guiApi } from "../../../../../shared/conversation/api";

const load: ConversationSearch = ({ search, ...options }) =>
  guiApi.request({ operation: "list", ...options, search: search || undefined });

export function useConversationCandidates(options: { active: boolean; connected: boolean; query: string }) {
  return useCandidates({ ...options, load });
}
