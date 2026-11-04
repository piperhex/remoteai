import { useViewportThreadPagination } from '../../../../../shared/remote-chat/client/useViewportThreadPagination';
import type { GuiController } from "./controller";
import type { GuiState } from "../../../../../shared/conversation/types";

export function useThreadPagination({ state, controller, enabled }: {
  state: GuiState; controller: GuiController; enabled: boolean;
}) {
  return useThreadScrollPagination({
    enabled: enabled && state.connection === "ready",
    loading: state.loading,
    scope: JSON.stringify([state.archived, state.search, state.connection]),
    cursor: state.cursor,
    loadMore: () => controller.refresh(true),
  });
}

export function useThreadScrollPagination(options: {
  enabled: boolean; loading: boolean; scope: string; cursor: string | null; loadMore: () => Promise<void>;
}) {
  const { list } = useViewportThreadPagination({ ...options, retryOnScroll: true });
  return { ref: list };
}
