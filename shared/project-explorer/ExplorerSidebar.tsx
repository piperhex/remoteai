import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Folder, HardDrive, House, Monitor } from 'lucide-react';
import { samePath, textKey, type ExplorerEntry, type ExplorerProps } from './model';
import type { ExplorerState } from './useExplorer';

const SHORTCUTS = [
  { key: 'home', Icon: House },
  { key: 'desktop', Icon: Monitor },
  { key: 'downloads', Icon: Download },
] as const;

function Drive({ entry, props, state, busy }: {
  entry: ExplorerEntry; props: ExplorerProps; state: ExplorerState; busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<ExplorerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = /^[a-z]:[\\/]?$/i.test(entry.path)
    ? props.t(textKey('disk'), { drive: entry.path.slice(0, 2) }) : entry.name;
  const toggle = async () => {
    if (loading) return;
    if (expanded) { setExpanded(false); return; }
    setExpanded(true); setLoading(true); setFailed(false);
    try { setChildren((await props.load(entry.path)).entries.map(child => ({ ...child, directory: true }))); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  };
  return <div>
    <div className="pe-drive">
      <button type="button" className="pe-expand" aria-label={label} aria-expanded={expanded}
        disabled={busy || loading} onClick={() => void toggle()}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
      <button type="button" aria-current={samePath(state.directory, entry.path) ? 'location' : undefined}
        title={entry.path} disabled={busy} onClick={() => state.navigate(entry.path)}>
        <HardDrive size={19} /><span>{label}</span></button>
    </div>
    {expanded && <div className="pe-drive-children">
      {loading && <span role="status">{props.t('client.projectBrowser.loading')}</span>}
      {failed && <button type="button" onClick={() => { setExpanded(false); }}>{props.t(textKey('loadError'))}</button>}
      {children.map(child => <button type="button" key={child.path} disabled={busy} title={child.path}
        aria-current={samePath(state.directory, child.path) ? 'location' : undefined}
        onClick={() => state.navigate(child.path)}><Folder size={17} /><span>{child.name}</span></button>)}
    </div>}
  </div>;
}

export function ExplorerSidebar({ props, state, busy }: { props: ExplorerProps; state: ExplorerState; busy: boolean }) {
  const projects = [...new Map((props.projects ?? []).map(project => [project.cwd, project])).values()];
  return <aside className="pe-sidebar" aria-label={props.t(textKey('computer'))}>
    <div className="pe-shortcuts">
      {SHORTCUTS.map(({ key, Icon }) => {
        const path = state.shortcuts?.[key];
        return <button type="button" key={key} title={path ?? undefined} disabled={busy || !path}
          aria-current={path && samePath(state.directory, path) ? 'location' : undefined}
          onClick={() => { if (path) state.navigate(path); }}>
          <Icon size={19} aria-hidden="true" /><span>{props.t(textKey(key))}</span></button>;
      })}
    </div>
    <button type="button" className="pe-computer" disabled={busy} onClick={() => state.navigate('')}
      aria-current={!state.directory ? 'location' : undefined}>
      <ChevronDown size={14} /><Monitor size={19} /><span>{props.t(textKey('computer'))}</span></button>
    {state.rootsError && <button type="button" onClick={state.refresh}>{props.t('client.terminal.retry')}</button>}
    {state.roots.map(entry => <Drive key={entry.path} entry={entry} props={props} state={state} busy={busy} />)}
    {!!projects.length && <><h3>{props.t(textKey('recent'))}</h3>
      {projects.map(project => <button type="button" className="pe-recent" key={project.cwd} title={project.cwd}
        disabled={busy} aria-current={samePath(state.directory, project.cwd) ? 'location' : undefined}
        onClick={() => state.navigate(project.cwd)}><Folder size={18} /><span>{project.label}</span></button>)}
    </>}
  </aside>;
}
