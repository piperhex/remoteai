import { displayText, uiText } from "../../../../../../shared/localization/uiText";
import type { ReactNode } from 'react';
import { Button, Segmented } from 'antd';
import { ChevronRight, Folder, FolderSync, Layers, Pin, RefreshCw, Search, SquarePen } from 'lucide-react';
import { RemoteProjectMenu } from '../../../../../../shared/remote-chat/client/RemoteProjectMenu';
import type { ChatSidebarActions } from '../../../../../../shared/remote-chat/views/ConnectedChat';
import type { ChatController, ChatState } from '../../../../../../shared/remote-chat/views/types';
import { useThreadGroups } from '../../../../../../shared/remote-chat/client/useThreadGroups';
import { useThreadActions } from '../../../../../../shared/remote-chat/client/useThreadActions';
import { threadPresentation } from '../../../../../../shared/remote-chat/sidebar';
import { FocusModeButton, type GuiFocusMode } from '../FocusModeButton';
import { ThreadStatus } from '../ThreadStatus';
import { ThreadPagination } from '../ThreadPagination';
import { ResizableThreadSidebar } from '../ResizableThreadSidebar';
import { useThreadScrollPagination } from '../useThreadPagination';
import { RemoteThreadDialogs, RemoteThreadMenu } from './RemoteThreadMenu';
import styles from '../../../../../../shared/conversation/styles.module.less';
import groupsStyle from '../ThreadGroup.module.less';
import navigationStyle from '../GuiNavigation.module.less';
import { BrowserGroups } from '../../../../../../shared/chat/groups/BrowserGroups';
import { GroupHeading } from '../../../../../../shared/chat/groups/GroupHeading';
import { useGrouping } from '../../../../../../shared/chat/groups/context';
import { remoteSidebarDrag } from '../../../../../../shared/remote-chat/client/sidebarDrag';
import { useCliGui } from '../../../../../../shared/cli-gui/context';
import { CliConversationList } from '../../../../../../shared/cli-gui/CliConversationList';

export function RemoteGuiSidebar(props: Parameters<typeof RemoteGuiSidebarContent>[0]) {
  return <BrowserGroups grouping={props.state.sidebar.grouping} client={props.controller.groups}
    drag={remoteSidebarDrag(props.state, props.controller)}
    translate={uiText} ready={props.state.ready}><RemoteGuiSidebarContent {...props} /></BrowserGroups>;
}

function RemoteGuiSidebarContent({ state, controller, actions, accountPicker, focusMode, syncing, onOpenSync }: {
  state: ChatState; controller: ChatController; actions: ChatSidebarActions;
  accountPicker: ReactNode; focusMode: GuiFocusMode;
  syncing?: boolean; onOpenSync?: () => void;
}) {
  const { groups: projectGroups, toggle, toggleCollapse } = useThreadGroups(state);
  const groups = projectGroups.map(group => ({
    ...group, label: group.kind === 'group' || group.cwd ? group.label
      : uiText(group.id === 'ungrouped' ? 'client.groups.ungrouped' : 'client.chat.recent'),
  }));
  const threadActions = useThreadActions(state, controller);
  const grouping = useGrouping();
  const cli = useCliGui();
  const renderHeading = (group: typeof groups[number]) => <button type="button" className={groupsStyle.heading}
    aria-expanded={!group.collapsed} onClick={() => toggleCollapse(group.id)}>
    <span className={groupsStyle.icon} aria-hidden="true">
      <Folder size={14} className={groupsStyle.folder} />
      <ChevronRight size={14} className={groupsStyle.arrow} />
    </span><span className={groupsStyle.label}>{group.label}</span>
    {state.sidebar.pinnedProjects?.includes(group.cwd)
      && <Pin size={12} className={groupsStyle.pin} aria-label={uiText('client.workspaceActions.pinned')} />}
  </button>;
  const pagination = useThreadScrollPagination({
    enabled: state.ready,
    loading: state.loading,
    scope: JSON.stringify([state.archived, state.search, state.ready]),
    cursor: state.cursor,
    loadMore: () => controller.list({ more: true }),
  });
  return <ResizableThreadSidebar className="gui-remote-sidebar" layoutSelector=".chat-diff-layout">
    <div className={styles.sidebarHeading} data-tauri-drag-region>
      <h2 className={styles.sidebarTitle} data-tauri-drag-region>Codex GUI</h2>
      <div className={styles.sidebarActions}>
        <Button type="text" size="small" icon={<Layers size={15} />} aria-label={uiText('client.groups.manage')}
          onClick={grouping?.openManager} />
        <FocusModeButton {...focusMode} />
        <Button type="text" size="small" icon={<RefreshCw size={15} />} aria-label={uiText("client.workspaceActions.refreshConversations")}
          loading={Boolean(state.listRefreshing)} disabled={!state.ready}
          onClick={() => void controller.list()} />
        <Button type="text" size="small" icon={<Search size={15} />} aria-label={uiText("client.workspaceActions.searchConversations")}
          disabled={!state.ready} onClick={actions.openSearch} />
      </div>
    </div>
    <nav className={navigationStyle.navigation} aria-label={uiText("client.workspaceSettings.codexGuiNavigation")}>
      <button type="button" disabled={state.sending} onClick={() => actions.newChat()}>
        <SquarePen size={18} strokeWidth={1.6} /><span>{uiText("client.workspaceSettings.newConversation")}</span>
      </button>
      {onOpenSync && <button type="button" aria-current={syncing ? 'page' : undefined} onClick={onOpenSync}>
        <FolderSync size={18} strokeWidth={1.6} aria-hidden="true" />
        <span>{uiText('client.workspaceSettings.conversationSync')}</span>
      </button>}
    </nav>
    <Segmented className={styles.threadFilter} block size="small" value={state.archived ? 'archived' : 'recent'}
      options={[{ label: uiText("client.chat.recent"), value: 'recent' }, { label: uiText("client.mobile.archived"), value: 'archived' }]}
      disabled={!state.ready || state.loading}
      onChange={value => { void controller.list({ archived: value === 'archived' }); }} />
    <div className={styles.threadList} aria-busy={state.loading} {...pagination}>
      <CliConversationList archived={state.archived} onSelect={actions.onClose} />
      {groups.map(group => <section className={groupsStyle.group} aria-label={group.label} key={group.id}
        style={{ paddingInlineStart: Math.min(group.depth, 8) * 14,
          ...(group.kind === 'group' ? { margin: '0 0 4px' } : {}) }}>
        {group.kind === 'group' ? <GroupHeading id={group.id.slice('group:'.length)} label={group.label} icon={group.icon}
          collapsed={group.collapsed} toggle={() => toggleCollapse(group.id)} /> :
        <div className={groupsStyle.header}>
          {group.cwd ? <RemoteProjectMenu cwd={group.cwd} label={group.label} state={state} controller={controller}
            translate={uiText} buttonClassName={groupsStyle.add}>{renderHeading(group)}</RemoteProjectMenu>
            : renderHeading(group)}
          {group.cwd && <button type="button" className={groupsStyle.add}
            aria-label={uiText("client.chat.startAChatIn", { value1: group.label })} disabled={state.sending}
            onClick={() => actions.newChat(group)}><SquarePen size={14} strokeWidth={1.6} /></button>}
        </div>}
        <div className={groupsStyle.content} hidden={group.collapsed}>
          {group.data.map(thread => {
            const view = threadPresentation(thread, state.sidebar, displayText);
            const selected = (!cli || cli.state.engine === 'codex') && state.selected?.id === thread.id;
            return <RemoteThreadMenu key={thread.id} thread={thread} state={state} controller={controller}
              actions={threadActions} onClose={actions.onClose}>
              <div className={`${styles.thread} ${selected ? styles.selected : ''}`}>
                <button type="button" className={styles.threadSelect} aria-label={view.title}
                  aria-current={selected ? 'page' : undefined} disabled={!state.ready || state.sending}
                  onClick={() => { cli?.controller.showCodex(); void controller.select(thread); actions.onClose(); }}>
                  <span className={styles.threadTitle}>{view.title}</span>
                  <ThreadStatus running={view.running} unread={view.unread}
                    needsInput={state.approvals.some(event => event.params.threadId === thread.id)} />
                </button>
              </div>
            </RemoteThreadMenu>;
          })}
          {group.canToggle && <button type="button" className={groupsStyle.more}
            aria-expanded={group.expanded} onClick={() => toggle(group.id)}>
            {group.expanded ? uiText("client.chat.collapse") : uiText("client.chat.showMore.83ad87")}</button>}
        </div>
      </section>)}
      {!state.threads.length && !cli?.state.sessions.length && <p className={styles.listEmpty}>{state.ready ? uiText("client.workspaceActions.noConversationsYet") : uiText("client.workspaceActions.connectToAComputerToViewConversations")}</p>}
      {state.cursor && <ThreadPagination loading={state.loading} />}
    </div>
    {accountPicker}
    <RemoteThreadDialogs actions={threadActions} />
  </ResizableThreadSidebar>;
}
