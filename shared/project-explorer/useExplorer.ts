import { useEffect, useRef, useState } from 'react';
import type { ProjectDirectoriesResponse } from '../remote-chat/projectDirectories';
import { samePath, visibleEntries, type ExplorerEntry, type ExplorerProps, type Sort, type View } from './model';
import { loadDirectory } from './loadDirectory';

const VIEW_STORAGE = 'remoteai:project-explorer:view';
function savedView(): View {
  try {
    const value = localStorage.getItem(VIEW_STORAGE);
    if (['extraLarge', 'large', 'medium', 'small', 'list', 'details', 'tiles', 'content'].includes(value ?? '')) {
      return value as View;
    }
  } catch { /* Storage is optional in private browser sessions. */ }
  return 'details';
}

export function useExplorer({ load, cwd = '' }: Pick<ExplorerProps, 'load' | 'cwd'>) {
  const [history, setHistory] = useState({ paths: [cwd], index: 0 });
  const directory = history.paths[history.index];
  const [result, setResult] = useState<ProjectDirectoriesResponse>();
  const [roots, setRoots] = useState<ExplorerEntry[]>([]);
  const [shortcuts, setShortcuts] = useState<ProjectDirectoriesResponse['shortcuts']>({});
  const [rootsError, setRootsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [view, updateView] = useState<View>(savedView);
  const [sort, setSort] = useState<Sort>('name');
  const [descending, setDescending] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [details, setDetails] = useState(false);
  const requestId = useRef(0);
  const hostLoad = useRef(load);
  const rootRequest = useRef<{ load: typeof load; promise: Promise<ProjectDirectoriesResponse> }>();
  useEffect(() => {
    const id = ++requestId.current;
    if (hostLoad.current !== load) {
      hostLoad.current = load;
      setRoots([]); setShortcuts({});
    }
    if (rootRequest.current?.load !== load) {
      rootRequest.current = { load, promise: loadDirectory(load, '') };
    }
    const roots = rootRequest.current.promise;
    setRootsError(false);
    void roots.then(value => {
      if (id !== requestId.current) return;
      setRoots(value.entries.map(entry => ({ ...entry, directory: true })));
      setShortcuts(value.shortcuts ?? {});
    }).catch(() => { if (id === requestId.current) setRootsError(true); });
    setLoading(true); setError(false); setResult(undefined); setSelected('');
    // The computer view and sidebar share one request; folder navigation reuses the host roots.
    void (directory ? loadDirectory(load, directory, true) : roots).then(value => {
      if (id === requestId.current) setResult(value);
    }).catch(() => { if (id === requestId.current) setError(true); })
      .finally(() => { if (id === requestId.current) setLoading(false); });
    return () => { requestId.current++; };
  }, [load, directory, revision]);
  const navigate = (path: string) => {
    setQuery(''); setSelected(''); setResult(undefined); setLoading(true);
    setHistory(current => samePath(current.paths[current.index], path) ? current
      : { paths: [...current.paths.slice(0, current.index + 1), path], index: current.index + 1 });
    setRevision(value => value + 1);
  };
  const travel = (offset: number) => {
    setQuery(''); setSelected(''); setResult(undefined); setLoading(true);
    setHistory(current => ({ ...current, index: Math.max(0, Math.min(current.paths.length - 1,
      current.index + offset)) }));
  };
  const setView = (value: View) => {
    updateView(value);
    try { localStorage.setItem(VIEW_STORAGE, value); } catch { /* View choice still works without storage. */ }
  };
  const entries = visibleEntries({ entries: (result?.entries ?? []).map(entry => ({
    ...entry, directory: entry.directory !== false,
  })), query, hidden, sort, descending });
  const selection = entries.find(entry => entry.path === selected);
  return { directory: result?.directory ?? directory, result, roots, shortcuts, rootsError, loading, error, entries,
    selection, selected, setSelected, query, setQuery: (value: string) => { setQuery(value); setSelected(''); },
    view, setView, sort, setSort, descending, setDescending, hidden, setHidden, details, setDetails,
    navigate, travel, canBack: history.index > 0, canForward: history.index < history.paths.length - 1,
    refresh: () => { rootRequest.current = undefined; setRevision(value => value + 1); } };
}
export type ExplorerState = ReturnType<typeof useExplorer>;
