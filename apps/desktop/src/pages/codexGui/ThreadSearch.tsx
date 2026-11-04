import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Spin, type InputRef } from "antd";
import { ArrowUpRight, Folder, MessageSquare, Search } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiState } from "../../../../../shared/conversation/types";
import { projectName, threadTitle } from "./ThreadSidebar";
import styles from "./threadSearch.module.less";

const SEARCH_DELAY_MS = 300;
const SEARCH_MODAL_WIDTH = 720;

interface Props {
  state: GuiState;
  controller: GuiController;
  onClose: () => void;
}

export function ThreadSearch({ state, controller, onClose }: Props) {
  const [query, setQuery] = useState(state.search);
  const search = query.trim();
  const input = useRef<InputRef>(null);
  const loading = state.loading || search !== state.search;
  let sectionTitle = state.archived ? uiText("client.workspaceActions.archivedConversations") : uiText("client.workspaceActions.recentConversations");
  if (search) sectionTitle = uiText("client.shared.searchResults");
  useEffect(() => {
    if (search === state.search || state.connection !== "ready") return;
    const timer = setTimeout(() => controller.filter(search, state.archived), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, state.search, state.archived, state.connection, controller]);

  return <Modal open centered className={styles.modal} title={uiText("client.workspaceActions.searchConversations")} footer={null}
    width={SEARCH_MODAL_WIDTH} onCancel={onClose}
    afterOpenChange={(open) => { if (open) input.current?.focus(); }}>
    <p className={styles.description}>{uiText("client.workspaceActions.findAPreviousConversationAndPickUpWhereYouLeft")}</p>
    <Input ref={input} className={styles.search} prefix={<Search size={20} aria-hidden="true" />}
      placeholder={uiText("client.workspaceActions.enterKeywordsToSearchConversations")} aria-label={uiText("client.workspaceActions.searchConversations")}
      value={query} allowClear onChange={(event) => setQuery(event.target.value)} />
    <div className={styles.sectionHeading}>
      <span>{sectionTitle}</span>
      {!loading && <span className={styles.count}>
        {state.threads.length}{state.cursor ? "+" : ""} {uiText("client.workspaceActions.conversations")}</span>}
    </div>
    <div className={styles.results} aria-label={uiText("client.mobile.conversations")} aria-busy={loading}>
      <ThreadSearchResults state={state} controller={controller} onClose={onClose} search={search} loading={loading} />
      {state.cursor && <Button type="text" block loading={loading} disabled={state.connection !== "ready"}
        onClick={() => void controller.refresh(true)}>{uiText("client.chat.loadMore")}</Button>}
    </div>
    <div className={styles.footer}><span>{uiText("client.workspaceActions.chooseAConversationToContinueChatting")}</span><span><kbd>Esc</kbd> {uiText("client.projectBrowser.close")}</span></div>
  </Modal>;
}

function ThreadSearchResults({ state, controller, onClose, search, loading }: Props & {
  search: string; loading: boolean;
}) {
  if (loading) return <div className={styles.empty} role="status">
    <Spin size="small" /><span>{uiText("client.workspaceActions.findingConversations")}</span>
  </div>;
  if (!state.threads.length) return <div className={styles.empty} role="status">
    <Search size={28} strokeWidth={1.5} aria-hidden="true" />
    <span>{search ? uiText("client.workspaceActions.noMatchingConversations") : uiText("client.workspaceActions.noConversationsYet")}</span>
    {search && <span className={styles.emptyHint}>{uiText("client.workspaceActions.tryAnotherKeyword")}</span>}
  </div>;
  return <>{state.threads.map((thread) => <button key={thread.id} className={styles.result}
    type="button" aria-label={threadTitle(thread)}
    disabled={state.sending || state.connection !== "ready"} onClick={() => {
      void controller.select(thread.id);
      onClose();
    }}>
    <span className={styles.threadIcon}><MessageSquare size={18} aria-hidden="true" /></span>
    <span className={styles.details}>
      <span className={styles.title}>{threadTitle(thread)}</span>
      <span className={styles.project}><Folder size={12} aria-hidden="true" />
        <span>{projectName(thread.cwd)}</span>
      </span>
    </span>
    <ArrowUpRight className={styles.openIcon} size={17} aria-hidden="true" />
  </button>)}</>;
}
