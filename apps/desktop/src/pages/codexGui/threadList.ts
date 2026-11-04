import { ThreadListCache, type ThreadListQuery } from '../../../../../shared/remote-chat/client/threadListCache';
import { readThreadListPage } from '../../../../../shared/remote-chat/client/threadListPages';
import { guiApi } from '../../../../../shared/conversation/api';
import type { GuiEvent, GuiState, Thread } from '../../../../../shared/conversation/types';

interface Host {
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  observe: (threads: Thread[]) => void;
  report: (error: unknown) => void;
}

function visibleThreads(state: GuiState, threads: Thread[]) {
  const live = state.archived || state.search ? [] : Object.values(state.conversations)
    .filter(value => value.activeTurn).map(value => value.thread);
  const listedIds = new Set(threads.map(thread => thread.id));
  return [...threads, ...live.filter(thread => !listedIds.has(thread.id))].map(thread => ({
    ...thread, turns: undefined, cwd: state.projectOverrides[thread.id] ?? thread.cwd,
    // The list can lag behind the first user-message notification.
    preview: thread.preview || state.conversations[thread.id]?.thread.preview || '',
  }));
}

export class GuiThreadList {
  readonly cache = new ThreadListCache(query => guiApi.request({ operation: 'list', ...query }));
  private generation = 0;

  constructor(private readonly host: Host) {}

  reset() { this.generation += 1; }

  readRemote = async (query: ThreadListQuery, options: { pageSize: number; force?: boolean }) => {
    const result = await readThreadListPage(this.cache, query, options);
    this.publish();
    return result;
  };

  receiveRemote = (event: GuiEvent) => {
    if (['connection/closed', 'connection/restored'].includes(event.method)) this.cache.invalidate();
    const before = this.cache.peek(this.host.getSnapshot());
    this.cache.receive(event);
    if (before?.data !== this.cache.peek(this.host.getSnapshot())?.data) this.publish();
  };

  private publish() {
    const state = this.host.getSnapshot();
    const cached = this.cache.peek(state);
    if (cached) this.host.patch({ threads: visibleThreads(state, cached.data), cursor: cached.nextCursor });
  }

  refresh = async (more = false, force = !more) => {
    const state = this.host.getSnapshot();
    if (more && (!state.cursor || state.loading)) return;
    const generation = ++this.generation;
    const cached = !more && !force ? this.cache.get(state) : undefined;
    if (cached) {
      this.host.patch({ threads: visibleThreads(state, cached.data), cursor: cached.nextCursor, loading: false });
      return;
    }
    this.host.patch({ loading: true });
    try {
      const response = await this.cache.read({ archived: state.archived, search: state.search || undefined,
        cursor: more ? state.cursor ?? undefined : undefined }, force);
      if (generation !== this.generation) return;
      this.host.observe(response.data);
      this.host.patch({ threads: visibleThreads(this.host.getSnapshot(), response.data), cursor: response.nextCursor });
    } catch (error) { if (generation === this.generation) this.host.report(error); }
    finally { if (generation === this.generation) this.host.patch({ loading: false }); }
  };

  filter = (search: string, archived: boolean) => {
    const cached = this.cache.peek({ search, archived });
    this.host.patch({ search, archived, threads: cached?.data ?? [], cursor: cached?.nextCursor ?? null });
    void this.refresh(false, false);
  };
}
