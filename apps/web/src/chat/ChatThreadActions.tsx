import { displayError } from '../i18n/index';
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { ThreadActionsModel } from '../../../../shared/remote-chat/client/useThreadActions';
import { THREAD_NAME_LIMIT } from '../../../../shared/remote-chat/client/threadActions';
import { t } from '../i18n';
import { useDesktopLayout } from '../useDesktopLayout';
import './thread-actions.css';
import { useGrouping } from '../../../../shared/chat/groups/context';
import { GroupIcon } from '../../../../shared/chat/groups/GroupIcon';

export function ChatThreadActions({ actions }: { actions: ThreadActionsModel }) {
  const groups = useGrouping();
  const desktop = useDesktopLayout();
  if (!actions.target || (desktop && actions.view === 'menu')) return null;
  const { view, name, busy, error, reason } = actions;
  const archive = actions.target.archived ? 'unarchive' : 'archive';
  const titles = { menu: t("client.threadActions.actions", { name: actions.target.title }),
    rename: t("client.threadActions.renameChat"), delete: t("client.threadActions.deleteThisChat") };
  const hint = reason(view === 'menu' ? archive : view);
  return <AdaptiveSheet open title={titles[view]} truncateTitle width={400} onClose={actions.close}
    onBack={!desktop && view !== 'menu' && !busy ? () => actions.changeView('menu') : undefined}>
    <div className="chat-thread-actions" aria-busy={busy}>
      {view === 'menu' && <>
        {groups && <button type="button" disabled={!groups.ready} onClick={() => {
          groups.setMoveTarget({ kind: 'thread', id: actions.target!.thread.id }); actions.close();
        }}><GroupIcon />{t('client.groups.move')}</button>}
        <button type="button" disabled={!!reason('rename')} onClick={() => actions.changeView('rename')}>
          <Pencil size={19} />{t("client.threadActions.renameChat")}</button>
        <button type="button" disabled={!!reason(archive)} onClick={() => void actions.submit(archive)}>
          {actions.target.archived ? <ArchiveRestore size={19} /> : <Archive size={19} />}
          {t(actions.target.archived ? "client.chat.restore" : "client.threadActions.archive")}</button>
        <button type="button" className="chat-thread-danger" disabled={!!reason('delete')}
          onClick={() => actions.changeView('delete')}><Trash2 size={19} />{t("client.threadActions.deleteChat")}</button>
      </>}
      {view !== 'menu' && <form onSubmit={event => { event.preventDefault(); void actions.submit(view); }}>
        {view === 'rename' ? <input aria-label={t("client.threadActions.chatName")} autoFocus value={name} disabled={busy}
          maxLength={THREAD_NAME_LIMIT} onChange={event => actions.setName(event.target.value)}
          onFocus={event => event.target.select()} />
          : <p>{t("client.threadActions.thisChatAndAllItsChildChatsWillMoveTo")}</p>}
        <div className="chat-thread-action-buttons">
          <button type="button" disabled={busy} onClick={actions.close}>{t("client.accounts.cancel")}</button>
          <button type="submit" className={view === 'delete' ? 'chat-thread-danger' : ''}
            disabled={busy || !!hint || (view === 'rename' && !name.trim())}>
            {busy ? t("client.threadActions.working") : t(view === 'rename' ? "client.projectBrowser.save" : "client.threadActions.deleteChat")}</button>
        </div>
      </form>}
      {!!(error || hint) && <p role="alert" className={error ? 'chat-error' : 'chat-muted'}>{displayError(error || hint)}</p>}
    </div>
  </AdaptiveSheet>;
}
