import { t, useLanguage } from '../i18n';
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Layers, LoaderCircle, Pin, Plus, RefreshCw, Search } from 'lucide-react';
import { RemoteProjectMenu } from '../../../../shared/remote-chat/client/RemoteProjectMenu';
import type { ChatController, ChatProject, ChatState } from './types';
import { useThreadActions } from '../../../../shared/remote-chat/client/useThreadActions';
import { ChatThreadActions } from './ChatThreadActions';
import { ChatProjectActions } from './ChatProjectActions';
import { ChatProjectHeading } from './ChatProjectHeading';
import { useProjectActions } from '../../../../shared/remote-chat/client/useProjectActions';
import { ChatThreadRow } from './ChatThreadRow';
import { useThreadGroups } from '../../../../shared/remote-chat/client/useThreadGroups';
import { useThreadListScroll } from './useThreadListScroll';
import { useDesktopLayout } from '../useDesktopLayout';
import { useChatSearch } from '../../../../shared/chat/useChatSearch';
import { SidebarSearchInput } from '../../../../shared/chat/SidebarSearchInput';
import { ChatSearchResults } from './ChatSearchResults';
import { useOpenProjectFolder } from '../../../../shared/chat/useOpenProjectFolder';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import { BrowserGroups } from '../../../../shared/chat/groups/BrowserGroups';
import { GroupHeading } from '../../../../shared/chat/groups/GroupHeading';
import { useGrouping } from '../../../../shared/chat/groups/context';

interface Props {
  state: ChatState; controller: ChatController; newChat: (project?: ChatProject) => void; onClose: () => void;
  openSearch: () => void; profile: ReactNode; accountPicker?: ReactNode;
}

export function ChatThreads(props: Props) {
  useLanguage();
  return <BrowserGroups grouping={props.state.sidebar.grouping} client={props.controller.groups}
    translate={t} ready={props.state.ready}><ChatThreadsContent {...props} /></BrowserGroups>;
}

function ChatThreadsContent({ state, controller, newChat, onClose, openSearch, profile, accountPicker }: Props) {
  useLanguage();
  const desktop = useDesktopLayout();
  const grouping = useGrouping();
  const [query, setQuery] = useState('');
  const searching = desktop && Boolean(query.trim());
  const search = useChatSearch({ controller, query: desktop ? query : '',
    archived: state.archived, ready: state.ready });
  const { groups, toggle, toggleCollapse } = useThreadGroups(state);
  const pagination = useThreadListScroll(state, controller, !searching);
  const ready = state.ready;
  const actions = useThreadActions(state, controller);
  const projectActions = useProjectActions(state, controller);
  const openProject = useOpenProjectFolder(controller.guiTools.files, t);
  const renderHeading = (group: typeof groups[number]) => desktop ? <h3 className="chat-grow">
    <button type="button" className="chat-project-toggle" aria-expanded={!group.collapsed}
      aria-label={`${group.collapsed ? t('client.chat.expandProject') : t('client.chat.collapseProject')}：${group.label}`}
      onClick={() => toggleCollapse(group.id)}>
      {group.collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      <span className="chat-ellipsis">{group.label}</span>
      {state.sidebar.pinnedProjects?.includes(group.cwd)
        && <Pin size={12} aria-label={t('client.workspaceActions.pinned')} />}
    </button>
  </h3> : <ChatProjectHeading project={group}
    collapsed={group.collapsed} pinned={Boolean(state.sidebar.pinnedProjects?.includes(group.cwd))}
    mobile={!desktop} toggle={() => toggleCollapse(group.id)} openActions={() => projectActions.open(group)} />;
  return <>
    <div className="chat-row chat-thread-controls">
      <button type="button" className="chat-back" aria-label={t('client.groups.manage')}
        onClick={grouping?.openManager}><Layers size={17} /></button>
      {desktop ? <SidebarSearchInput value={query} onChange={setQuery} label={t("client.chat.searchChats")}
        clearLabel={t("client.projectBrowser.clearSearch")} onSubmit={search.reload} />
        : <button type="button" className="chat-search-trigger" aria-label={t("client.chat.searchChats")} onClick={openSearch}>
          <Search size={18} />{t("client.chat.searchChats")}</button>}
      <button className="chat-back" type="button" aria-label={t("client.chat.refreshChats")}
        disabled={!ready || state.listRefreshing}
        onClick={() => { if (searching) search.reload(); else void controller.list(); }}>
        <RefreshCw size={17} className={state.listRefreshing || search.loading ? 'chat-spinner' : undefined} />
      </button>
    </div>
    <div ref={pagination.list} className="chat-scroll chat-thread-list"
      aria-busy={searching ? search.loading : state.loading}>
      {searching ? <ChatSearchResults state={state} search={search} query={query}
        select={thread => { void controller.select(thread); onClose(); }} /> : <>
      {groups.map(group => ({ ...group, label: group.kind === 'group' || group.cwd
        ? group.label : t(group.id === 'ungrouped' ? 'client.groups.ungrouped' : 'client.chat.recent') })).map((group) =>
        <section className="chat-project-group" aria-label={group.label} key={group.id}
          style={{ paddingInlineStart: Math.min(group.depth, 8) * 14,
            ...(group.kind === 'group' ? { margin: '0 0 4px' } : {}) }}>
          {group.kind === 'group' ? <GroupHeading label={group.label} icon={group.icon}
            collapsed={group.collapsed} toggle={() => toggleCollapse(group.id)} /> :
          <div className="chat-project-heading">
            {desktop && group.cwd ? <RemoteProjectMenu cwd={group.cwd} label={group.label} state={state}
              controller={controller} translate={t} buttonClassName="chat-back" showActionButton={false}>
              {renderHeading(group)}</RemoteProjectMenu>
              : renderHeading(group)}
            {group.cwd && <button type="button" className="chat-back" aria-label={t("client.chat.startAChatIn", { value1: group.label })}
              disabled={state.sending} onClick={() => newChat(group)}><Plus size={18} aria-hidden="true" /></button>}
          </div>}
          <div style={group.kind === 'group' ? { paddingInlineStart: 32 } : undefined}>
          {group.data.map(thread => {
            const { cwd } = threadPresentation(thread, state.sidebar);
            return <ChatThreadRow key={thread.id} thread={thread} state={state}
            select={() => { void controller.select(thread); onClose(); }} actions={actions}
            onFork={() => { void controller.forkConversation(thread).then(opened => { if (opened) onClose(); }); }}
            onOpenProject={cwd ? () => openProject(cwd) : undefined} />;
          })}
          {group.canToggle && <button type="button" className="chat-group-more" aria-expanded={group.expanded}
            aria-label={`${group.expanded ? t("client.chat.collapse") : t("client.chat.showMore.83ad87")}：${group.label}`} onClick={() => toggle(group.id)}>
            {group.expanded ? t("client.chat.collapse") : t("client.chat.showMore.83ad87")}</button>}
          </div>
        </section>)}
      {!state.threads.length && <p className="chat-empty chat-muted">
        {ready ? t("client.chat.noChatsYet") : t("client.chat.connectToYourComputerToViewChats")}</p>}
      <div className="chat-thread-pagination">
        {pagination.loadingMore && <span role="status" className="chat-muted chat-row">
          <LoaderCircle size={16} className="chat-spinner" aria-hidden="true" />{t("client.projectBrowser.loading")}</span>}
        {state.cursor && pagination.failed && <button type="button" className="chat-button"
          disabled={!ready || state.loading} onClick={pagination.retry}>{t("client.chat.couldNotLoadSelectToRetry")}</button>}
      </div>
      </>}
    </div>
    {!desktop && <div className="chat-drawer-footer"><button className="chat-new-button" type="button"
      disabled={state.sending} onClick={() => newChat()}><Plus size={20} />{t("client.chat.newChat")}</button>{profile}</div>}
    {accountPicker}
    <ChatThreadActions actions={actions} />
    {!desktop && <ChatProjectActions actions={projectActions} />}
  </>;
}
