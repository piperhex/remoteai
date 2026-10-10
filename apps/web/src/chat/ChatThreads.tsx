import { t, useLanguage } from '../i18n';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react';
import type { ChatController, ChatProject, ChatState } from './types';
import { useThreadActions } from '../../../../shared/remote-chat/client/useThreadActions';
import { ChatThreadActions } from './ChatThreadActions';
import { ChatThreadRow } from './ChatThreadRow';
import { useThreadGroups } from '../../../../shared/remote-chat/client/useThreadGroups';
import { useThreadListScroll } from './useThreadListScroll';

interface Props {
  state: ChatState; controller: ChatController; newChat: (project?: ChatProject) => void; onClose: () => void;
  openSearch: () => void; profile: ReactNode; accountPicker?: ReactNode;
}

export function ChatThreads({ state, controller, newChat, onClose, openSearch, profile, accountPicker }: Props) {
  useLanguage();
  const { groups, toggle, toggleCollapse } = useThreadGroups(state);
  const pagination = useThreadListScroll(state, controller);
  const ready = state.ready;
  const actions = useThreadActions(state, controller);
  return <>
    <div className="chat-padded chat-thread-controls">
      <button type="button" className="chat-search-trigger" aria-label={t("搜索聊天")} onClick={openSearch}>
        <Search size={18} />{t("搜索聊天")}</button>
      <div className="chat-row">
        <button className="chat-button chat-grow" type="button" disabled={!ready || state.loading}
          onClick={() => { void controller.list({ archived: !state.archived }); }}>
          {state.archived ? t("已归档 ▾") : t("最近聊天 ▾")}</button>
        <button className="chat-back" type="button" aria-label={t("刷新聊天")} disabled={!ready || state.loading}
          onClick={() => { void controller.list(); }}>
          <RefreshCw size={17} className={state.listRefreshing ? 'chat-spinner' : undefined} /></button>
      </div>
    </div>
    <div ref={pagination.list} className="chat-scroll chat-thread-list" aria-busy={state.loading}>
      {groups.map(group => ({ ...group, label: group.cwd ? group.label : t('最近') })).map((group) =>
        <section className="chat-project-group" aria-label={group.label} key={group.cwd}>
          <div className="chat-project-heading">
            <h3 className="chat-grow"><button type="button" className="chat-project-toggle"
              aria-expanded={!group.collapsed} aria-label={`${group.collapsed ? t("展开项目") : t("折叠项目")}：${group.label}`}
              onClick={() => toggleCollapse(group.cwd)}>
              {group.collapsed ? <ChevronRight size={14} aria-hidden="true" />
                : <ChevronDown size={14} aria-hidden="true" />}
              <span className="chat-ellipsis">{group.label}</span>
            </button></h3>
            {group.cwd && <button type="button" className="chat-back" aria-label={t("在 {value1} 中新建对话", { value1: group.label })}
              disabled={state.sending} onClick={() => newChat(group)}><Plus size={18} aria-hidden="true" /></button>}
          </div>
          {group.data.map(thread => <ChatThreadRow key={thread.id} thread={thread} state={state}
            select={() => { void controller.select(thread); onClose(); }} openActions={() => actions.open(thread)} />)}
          {group.canToggle && <button type="button" className="chat-group-more" aria-expanded={group.expanded}
            aria-label={`${group.expanded ? t("收起") : t("展开显示")}：${group.label}`} onClick={() => toggle(group.cwd)}>
            {group.expanded ? t("收起") : t("展开显示")}</button>}
        </section>)}
      {!state.threads.length && <p className="chat-empty chat-muted">
        {ready ? t("暂时没有聊天") : t("连接电脑后查看聊天")}</p>}
      <div ref={pagination.end} className="chat-thread-pagination">
        {pagination.loadingMore && <span role="status" className="chat-muted chat-row">
          <LoaderCircle size={16} className="chat-spinner" aria-hidden="true" />{t("正在加载…")}</span>}
        {state.cursor && pagination.failed && <button type="button" className="chat-button"
          disabled={!ready || state.loading} onClick={pagination.retry}>{t("加载失败，点击重试")}</button>}
      </div>
    </div>
    <div className="chat-drawer-footer"><button className="chat-new-button" type="button"
      disabled={state.sending} onClick={() => newChat()}><Plus size={20} />{t("新聊天")}</button>{profile}</div>
    {accountPicker}
    <ChatThreadActions actions={actions} />
  </>;
}
