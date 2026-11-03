import { useState } from 'react';
import type { MessageKey } from '@remoteai/i18n';
import { Dropdown, Modal } from 'antd';
import { ChevronRight, LayoutGrid, List } from 'lucide-react';
import { directoryProject } from '../remote-chat/projectDirectories';
import { useTreeGesture } from '../project-browser/useTreeGesture';
import { TreeActionDialog } from '../project-browser/TreeActionDialog';
import { textKey, type ExplorerProps } from './model';
import { useExplorer } from './useExplorer';
import { useExplorerActions } from './useExplorerActions';
import { ExplorerNavigation } from './ExplorerNavigation';
import { ExplorerSidebar } from './ExplorerSidebar';
import { ExplorerEntries, ExplorerDetails } from './ExplorerEntries';
import { ExplorerToolbar, explorerMenus } from './ExplorerToolbar';
import './projectExplorer.css';

export function ProjectExplorer(props: ExplorerProps) {
  const { t } = props;
  const state = useExplorer(props);
  const actions = useExplorerActions(props, state);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const gesture = useTreeGesture(position => {
    if (actions.busy || state.loading) return;
    const target = document.elementFromPoint(position.x, position.y)?.closest<HTMLElement>('[data-path]');
    state.setSelected(target?.dataset.path ?? ''); setMenu(position);
  });
  const chosen = state.selection?.directory ? state.selection.path : state.result?.directory;
  const canChoose = !!chosen && !state.loading && !state.error && !actions.busy && !actions.prompt;
  const browsing = props.mode === 'browse';
  const choose = () => { if (!browsing && canChoose && chosen) props.choose(directoryProject(chosen)); };
  const menus = explorerMenus(state, actions, t);
  return <Modal open centered width="85vw" className="project-explorer-modal" footer={null}
    title={props.title ?? t('client.chat.chooseProject')} maskClosable={!actions.busy}
    keyboard={!actions.busy && !actions.prompt && !menu}
    closable={actions.busy ? false : { 'aria-label': t('client.projectBrowser.close') }}
    onCancel={() => { if (!actions.busy) props.close(); }}>
    <div className="pe-shell" onKeyDown={event => {
      if (actions.prompt || actions.busy || event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape' && menu) { event.stopPropagation(); setMenu(undefined); return; }
      if (event.key === 'F5') { event.preventDefault(); state.refresh(); }
      if (event.altKey && event.key === 'ArrowLeft' && state.canBack) { event.preventDefault(); state.travel(-1); }
      if (event.altKey && event.key === 'ArrowRight' && state.canForward) { event.preventDefault(); state.travel(1); }
      if (event.altKey && event.key === 'ArrowUp' && state.result?.parent != null) {
        event.preventDefault(); state.navigate(state.result.parent);
      }
      if (event.key === 'F2') { event.preventDefault(); actions.command('rename'); }
      if (event.key === 'Delete') { event.preventDefault(); actions.command('delete'); }
      if (event.ctrlKey || event.metaKey) {
        const command = { c: 'copy', x: 'cut', v: 'paste' } as const;
        const key = event.key.toLowerCase() as keyof typeof command;
        if (command[key]) { event.preventDefault(); actions.command(command[key]); }
      }
    }}>
      <ExplorerNavigation state={state} t={t} busy={actions.busy || !!actions.prompt} />
      <ExplorerToolbar state={state} actions={actions} t={t} />
      <div className="pe-workspace">
        <ExplorerSidebar props={props} state={state} busy={actions.busy || !!actions.prompt} />
        <div className="pe-content" {...gesture} onScrollCapture={() => setMenu(undefined)}
          onKeyDown={event => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
            event.preventDefault();
            const rect = (event.target as HTMLElement).getBoundingClientRect();
            setMenu({ x: rect.left + 20, y: rect.top + 20 });
          }}>
          <ExplorerEntries state={state} props={props} actions={actions} />
        </div>
        {state.details && <ExplorerDetails state={state} props={props} />}
      </div>
      <div className="pe-status"><span>{t(textKey('items'), { count: state.entries.length })}</span>
        {state.selection && <span>{t(textKey('selected'), { name: state.selection.name })}</span>}
        <span className="pe-status-message" role={actions.error ? 'alert' : 'status'}>
          {actions.prompt ? '' : actions.error || actions.message}</span>
        <button type="button" aria-label={t(textKey('details'))} aria-pressed={state.view === 'details'}
          onClick={() => state.setView('details')}><List size={17} /></button>
        <button type="button" aria-label={t(textKey('large'))} aria-pressed={state.view === 'large'}
          onClick={() => state.setView('large')}><LayoutGrid size={17} /></button>
      </div>
      <div className="pe-footer"><label>{t(textKey('selection'))}<input readOnly
        value={browsing ? state.directory : chosen ?? ''}
        aria-label={t(textKey('selection'))} /></label>
        {!browsing && <button type="button" className="pe-primary" disabled={!canChoose}
          onClick={choose}>{t(textKey('choose'))}</button>}
        <button type="button" disabled={actions.busy} onClick={props.close}>
          {t(browsing ? 'client.projectBrowser.close' : textKey('cancel'))}</button>
      </div>
      {menu && <Dropdown open trigger={[]} overlayClassName="pe-menu" placement="bottomLeft"
        onOpenChange={open => { if (!open) setMenu(undefined); }}
        menu={{ items: menus.context, expandIcon: <ChevronRight size={14} aria-hidden="true" />,
          onClick: () => setMenu(undefined) }}>
        <span className="pe-context-anchor" style={{ left: menu.x, top: menu.y }} />
      </Dropdown>}
      {actions.prompt && <TreeActionDialog key={`${actions.prompt.action}:${actions.prompt.entry.path}`}
        prompt={actions.prompt} busy={actions.busy} error={actions.error} connected
        confirm={name => void actions.confirm(name)} cancel={actions.cancel} t={key => t(key as MessageKey)} />}
    </div>
  </Modal>;
}
