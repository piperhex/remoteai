import { useEffect, useRef, useState, type RefObject } from 'react';
import { Input, Popover, type InputRef } from 'antd';
import { Folder, Plus, Search, X } from 'lucide-react';
import { guiText } from '../../i18n/guiText';
import { folderName, type SavedProject } from './projectCatalog';
import styles from './ProjectPicker.module.less';

interface Props {
  value: string; projects: SavedProject[]; disabled: boolean;
  onChange: (cwd: string) => void; onAdd: () => void; addLabel: string;
  onOpen?: () => void; onClear?: () => void; loading?: boolean; error?: string;
  ariaLabel?: string; triggerRef?: RefObject<HTMLButtonElement>;
}

export function ProjectFolderPicker(props: Props) {
  const { value, projects, disabled, onChange } = props;
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const fallbackTrigger = useRef<HTMLButtonElement>(null);
  const trigger = props.triggerRef ?? fallbackTrigger;
  const search = useRef<InputRef>(null);
  const list = useRef<HTMLDivElement>(null);
  const label = (path: string) => projects.find(project => project.path === path)?.name ?? folderName(path);
  const paths = [...new Set([value, ...projects.map(project => project.path)])].filter(Boolean);
  const matches = paths.filter(path => `${label(path)} ${path}`.toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase()));
  useEffect(() => { if (disabled) setExpanded(false); }, [disabled]);
  const close = () => { setExpanded(false); trigger.current?.focus(); };
  const panel = <div className={styles.panel} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const options = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = current + (event.key === 'ArrowDown' ? 1 : -1);
    event.preventDefault();
    if (next < 0 || next >= options.length) search.current?.focus();
    else options[next]?.focus();
  }}>
    <Input ref={search} variant="borderless" className={styles.search} prefix={<Search size={16} />}
      aria-label={guiText('搜索项目')} placeholder={guiText('搜索项目')} value={query}
      onChange={event => setQuery(event.target.value)} />
    <div ref={list} className={styles.list} role="menu" aria-label={guiText('项目')} aria-busy={props.loading}>
      {matches.map(path => <button key={path} type="button" role="menuitemradio" aria-checked={value === path}
        className={styles.option} disabled={disabled} title={path}
        onClick={() => { if (!disabled) { onChange(path); close(); } }}>
        <Folder size={18} aria-hidden="true" /><span>{label(path)}</span>
      </button>)}
      {!matches.length && !props.loading && <p className={styles.empty}>
        {query.trim() ? guiText('没有找到匹配的项目') : guiText('还没有项目')}</p>}
    </div>
    {props.loading && <p role="status" className={styles.empty}>{guiText('正在读取项目…')}</p>}
    {props.error && <p role="alert" className={styles.empty}>{props.error}</p>}
    <div className={styles.divider} />
    <button type="button" className={`${styles.option} ${styles.newProject}`} disabled={disabled}
      onClick={() => { setExpanded(false); props.onAdd(); }}>
      <Plus size={20} aria-hidden="true" /><span>{props.addLabel}</span>
    </button>
  </div>;
  return <span className={styles.selection}>
    {value && props.onClear && <button type="button" className={styles.remove} disabled={disabled}
      aria-label={guiText('移除项目选择')} onClick={props.onClear}>
      <Folder className={styles.folder} size={16} aria-hidden="true" />
      <X className={styles.cross} size={16} aria-hidden="true" />
    </button>}
    <Popover trigger="click" placement="topLeft" arrow={false} open={expanded && !disabled} content={panel}
      onOpenChange={open => { setExpanded(open); if (open) { setQuery(''); props.onOpen?.(); } }}
      afterOpenChange={open => { if (open) search.current?.focus(); }}
      styles={{ root: { maxWidth: 400 }, body: { padding: 0, borderRadius: 20, overflow: 'hidden' } }}>
      <button ref={trigger} type="button" className={styles.name} disabled={disabled}
        aria-haspopup="menu" aria-expanded={expanded && !disabled} title={value || undefined}
        aria-label={props.ariaLabel ?? (value
          ? guiText('选择项目文件夹：{value1}', { value1: label(value) }) : guiText('选择项目文件夹'))}>
        {(!value || !props.onClear) && <Folder size={16} aria-hidden="true" />}
        <span>{value ? label(value) : guiText('选择项目')}</span>
      </button>
    </Popover>
  </span>;
}
