import { useState, type ReactNode } from 'react';
import { ArrowDownUp, ArrowLeft, ArrowRight, Check, Download, LayoutGrid, Search, X } from 'lucide-react';
import { displayError, displayText } from '../../i18n';
import { downloadManager } from '../manager';
import { DownloadBatchActions } from '../DownloadBatchActions';
import type { DownloadTask } from '../types';
import { useDownloadSelection } from '../../../../../shared/downloads/useDownloadSelection';
import { ActiveDownloadCard, ReadyDownloadRow, type DownloadItemProps } from './DownloadTaskItem';
import { isDownloadReady, visibleDownloads, type DownloadFilter, type DownloadSort,
  type DownloadText } from './downloadPresentation';
import './workspace.css';
import './taskItems.css';

interface WorkspaceProps {
  tasks: DownloadTask[]; owner: string; busy: boolean; error: string; text?: DownloadText;
  run: DownloadItemProps['run']; removeTasks: (ids: string[]) => void;
  onBack?: () => void; sources?: ReactNode; allowShare?: boolean;
}

const FILTER_LABELS = {
  all: 'client.configHelp.all', active: 'client.downloads.incomplete', ready: 'client.downloads.ready',
};

export function DownloadWorkspace({ tasks, owner, busy, error, run, removeTasks,
  text = displayText, onBack, sources, allowShare }: WorkspaceProps) {
  const [filter, setFilter] = useState<DownloadFilter>('all');
  const [sort, setSort] = useState<DownloadSort>('recent');
  const [query, setQuery] = useState('');
  const [batch, setBatch] = useState(false);
  const visible = visibleDownloads(tasks, { filter, query, sort });
  const selection = useDownloadSelection(visible, `${owner}:${filter}:${query}`);
  const ready = visible.filter(isDownloadReady);
  const active = visible.filter(task => !isDownloadReady(task));
  const readyCount = tasks.filter(isDownloadReady).length;
  const counts = { all: tasks.length, ready: readyCount, active: tasks.length - readyCount };
  const selecting = batch || selection.selected.size > 0;
  const allReadySelected = ready.length > 0 && ready.every(task => selection.selected.has(task.id));
  const toggleReady = () => {
    setBatch(true);
    ready.forEach(task => {
      if (selection.selected.has(task.id) === allReadySelected) selection.toggle(task.id);
    });
  };
  const itemProps = (task: DownloadTask): DownloadItemProps => ({
    task, busy, text, run, allowShare, selecting, selected: selection.selected.has(task.id),
    toggle: () => { setBatch(true); selection.toggle(task.id); },
    connected: !!downloadManager.connectionForSource(task.source)?.ready,
    retryAttempt: downloadManager.retryAttempt(task.id),
  });
  const reset = () => { setFilter('all'); setQuery(''); };
  return <section className="download-workspace" aria-label={text('client.downloads.downloads')}>
    <header className="dw-header">
      {onBack && <button type="button" className="dw-icon-button dw-back" onClick={onBack}
        aria-label={text('client.discovery.back')}><ArrowLeft size={22} /></button>}
      <div className="dw-title"><div><h1>{text('client.downloads.downloads')}</h1>
        <span className="dw-count">{text('client.downloads.tasks', { count: tasks.length })}</span></div>
      </div>
      <label className="dw-search"><Search size={20} aria-hidden />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)}
          aria-label={text('client.downloads.workspace.search')}
          placeholder={text('client.downloads.workspace.search')} />
        {query && <button type="button" className="dw-icon-button" onClick={() => setQuery('')}
          aria-label={text('client.downloads.workspace.clearSearch')}><X size={16} /></button>}
      </label>
    </header>
    <div className="dw-toolbar">
      <div className="dw-tabs" role="group" aria-label={text('client.downloads.workspace.filter')}>
        {(Object.keys(FILTER_LABELS) as DownloadFilter[]).map(value => <button key={value} type="button"
          aria-pressed={filter === value} className={filter === value ? 'is-active' : ''}
          onClick={() => setFilter(value)}>
          {text(FILTER_LABELS[value])}<span>{counts[value]}</span>
        </button>)}
      </div>
      <div className="dw-tools">
        {sources}
        <label className="dw-sort"><ArrowDownUp size={17} aria-hidden />
          <select value={sort} onChange={event => setSort(event.target.value as DownloadSort)}
            aria-label={text('client.downloads.workspace.sort')}>
            <option value="recent">{text('client.downloads.workspace.sortRecent')}</option>
            <option value="name">{text('client.downloads.workspace.sortName')}</option>
            <option value="size">{text('client.downloads.workspace.sortSize')}</option>
          </select>
        </label>
        <button type="button" className="dw-button" aria-pressed={selecting}
          onClick={() => { setBatch(!selecting); if (selecting) selection.clear(); }}>
          {selecting ? <Check size={17} /> : <LayoutGrid size={17} />}
          {text(selecting ? 'client.downloads.workspace.finishBatch' : 'client.downloads.workspace.batch')}
        </button>
      </div>
    </div>
    {selecting && <div className="dw-batch-bar">
      <span>{text('client.downloads.workspace.selectedCount', { count: selection.selected.size })}</span>
      <DownloadBatchActions count={selection.selected.size} total={visible.length}
        allSelected={selection.allSelected} busy={busy} text={text} toggleAll={selection.toggleAll}
        remove={() => removeTasks([...selection.selected])} />
    </div>}
    {error && <p role="alert" className="dw-notice dw-error">{displayError(error)}</p>}
    {active.length > 0 && <section className="dw-section">
      <div className="dw-section-heading"><h2>{text(FILTER_LABELS.active)}</h2>
        <span className="dw-count">{active.length}</span></div>
      <div className="dw-active-grid">{active.map(task => <ActiveDownloadCard key={task.id} {...itemProps(task)} />)}
      </div>
    </section>}
    {ready.length > 0 && <section className="dw-section">
      <div className="dw-section-heading"><h2>{text(FILTER_LABELS.ready)}</h2>
        <span className="dw-count">{ready.length}</span>
        <label className="dw-select-all"><input type="checkbox" className="dw-checkbox" checked={allReadySelected}
          disabled={busy} onChange={toggleReady} />{text('client.downloads.selectAll')}</label>
      </div>
      <div className="dw-ready-list">{ready.map(task => <ReadyDownloadRow key={task.id} {...itemProps(task)} />)}</div>
    </section>}
    {!visible.length && <div className="dw-empty"><Download size={40} strokeWidth={1.5} />
      <h2>{text(tasks.length ? 'client.downloads.noDownloadsInThisView' : 'client.downloads.noDownloadsYet')}</h2>
      <p>{text(query ? 'client.downloads.workspace.noSearchResults'
        : 'client.downloads.openAFileInChatAndChooseDownloadToSee')}</p>
    </div>}
    {(filter !== 'all' || query) && <footer className="dw-footer">
      <button type="button" onClick={reset}>
        {text('client.downloads.workspace.viewAll')}<ArrowRight size={18} /></button>
    </footer>}
  </section>;
}
