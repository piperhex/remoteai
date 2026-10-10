import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GitAction, GitChange, GitChanges, GitClient, GitCommit, GitDiff, GitRepository,
  GitStrategy } from './gitTypes';
import { toggleFiles } from './gitFiles';
import { GIT_ACTION_NOTICE } from './gitActions';
import { useGitFileList } from './useGitFileList';

const errorText = (error: unknown) => typeof error === 'string' ? error
  : error instanceof Error ? error.message : '无法读取 Git 信息，请稍后重试。';
export type GitDetail = { kind: 'files'; commit: GitCommit }
  | { kind: 'diff'; path: string; commit?: GitCommit; title: string };

export function parentGitDetail(detail: GitDetail | null): GitDetail | null {
  return detail?.kind === 'diff' && detail.commit ? { kind: 'files', commit: detail.commit } : null;
}

export function useRemoteGit({ client, cwd, active, connected }: {
  client: GitClient; cwd: string; active: boolean; connected: boolean;
}) {
  const scope = useMemo(() => ({}), [client, cwd]);
  const current = useRef(scope);
  current.current = scope;
  const pending = useRef(new Set<object>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [repository, setRepository] = useState<GitRepository | null>(null);
  const [strategy, setStrategy] = useState<GitStrategy>('merge');
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const fileList = useGitFileList(changes?.files ?? []);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'changes' | 'history'>('changes');
  const [detail, setDetail] = useState<GitDetail | null>(null);
  const load = useCallback(async () => {
    const [next, history, repository] = await Promise.all([
      client.changes(cwd), client.history(cwd, 0), client.repository(cwd)]);
    if (current.current !== scope) return;
    setChanges(next); setCommits(history.commits); setHasMore(history.hasMore);
    setRepository(repository);
    setSelected(previous => Object.fromEntries(next.files.filter(file =>
      !file.conflict && previous[file.path] === file.version).map(file => [file.path, file.version])));
  }, [client, cwd, scope]);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (pending.current.has(scope) || !connected || !cwd || !active) return;
    pending.current.add(scope); setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (error) { if (current.current === scope) setError(errorText(error)); }
    finally { pending.current.delete(scope); if (current.current === scope) setBusy(false); }
  }, [connected, cwd, active, scope]);
  const refresh = useCallback(() => run(load), [run, load]);
  useEffect(() => {
    current.current = scope;
    setChanges(null); setCommits([]); setSelected({}); setMessage(''); setDetail(null); setNotice(''); setError('');
    setRepository(null);
    return () => { current.current = {}; };
  }, [scope]);
  useEffect(() => { void refresh(); }, [refresh]);
  const selectFiles = (files: GitChange[]) => {
    if (busy) return;
    setSelected(previous => toggleFiles(previous, files));
  };
  const toggle = (file: GitChange) => selectFiles([file]);
  const selectAll = () => selectFiles(changes?.files ?? []);
  const commit = () => run(async () => {
    if (!changes || changes.files.some(file => file.conflict)
      || !message.trim() || !Object.keys(selected).length) return;
    const result = await client.commit({ cwd, head: changes.head, message: message.trim(),
      files: Object.entries(selected).map(([path, version]) => ({ path, version })) });
    if (current.current !== scope) return;
    setSelected({}); setMessage(''); setDetail(null); setNotice(`已提交 ${result.hash.slice(0, 8)}`);
    await load();
  });
  const action = (action: GitAction, target?: string) => run(async () => {
    if (!changes) return;
    let failure: unknown;
    try {
      await client.action({ cwd, action, target, strategy: action === 'update' ? 'merge' : strategy,
        head: changes.head, branch: changes.branch });
      if (current.current !== scope) return;
      setDetail(null); setNotice(GIT_ACTION_NOTICE[action]);
    } catch (error) { failure = error; }
    // Failed integration may leave conflicts that must be visible immediately.
    try { await load(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  });
  const more = () => run(async () => {
    const page = await client.history(cwd, commits.length);
    if (current.current !== scope) return;
    setCommits(previous => [...previous,
      ...page.commits.filter(commit => !previous.some(row => row.hash === commit.hash))]);
    setHasMore(page.hasMore);
  });
  return { busy, error, notice, changes, commits, hasMore, selected, message, setMessage, tab, setTab,
    detail, setDetail, backDetail: () => setDetail(parentGitDetail), refresh, toggle, selectAll, selectFiles, commit, more,
    repository, action, strategy, setStrategy, fileList,
    canCommit: connected && !busy && !!message.trim() && Object.keys(selected).length > 0
      && !changes?.files.some(file => file.conflict) };
}

export type RemoteGit = ReturnType<typeof useRemoteGit>;

export function useGitDiff(client: GitClient, cwd: string, detail: GitDetail | null, enabled: boolean) {
  const [value, setValue] = useState<GitDiff | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setValue(null); setError('');
    if (detail?.kind === 'diff' && enabled) void client.diff(cwd, detail.path, detail.commit?.hash).then(value => {
      if (alive) setValue(value);
    }).catch(error => { if (alive) setError(errorText(error)); });
    return () => { alive = false; };
  }, [client, cwd, detail, enabled]);
  return { value, error };
}
