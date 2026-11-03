import { useEffect, useRef, useState } from 'react';
import type { GroupingUI } from './context';
import { DEFAULT_GROUP_PAGE_SIZE, readMembersPage } from './memberPaging';
import { GROUPS_UNSUPPORTED_ERROR, type GroupMembersPage } from './model';

const SEARCH_DELAY_MS = 250;

export function usePagedGroupMembers(model: GroupingUI) {
  const [query, setQuery] = useState('');
  const [paging, setPaging] = useState({ page: 1, pageSize: DEFAULT_GROUP_PAGE_SIZE, search: '' });
  const [result, setResult] = useState<GroupMembersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const { page: requestedPage, pageSize, search } = paging;
  useEffect(() => {
    const timer = setTimeout(() => setPaging(current => current.search === query.trim()
      ? current : { ...current, page: 1, search: query.trim() }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;
    setLoading(true); setError('');
    const load = async () => {
      try {
        if (!model.ready) throw new Error('client.errors.connectToYourComputerFirst');
        if (!model.client.membersPage) throw new Error(GROUPS_UNSUPPORTED_ERROR);
        const page = readMembersPage(await model.client.membersPage({ page: requestedPage, pageSize, search }));
        if (cancelled || current !== generation.current) return;
        setResult(page);
        viewport.current?.scrollTo({ top: 0 });
      } catch (failure) {
        if (cancelled || current !== generation.current) return;
        setResult(null);
        setError(failure instanceof Error && failure.message === GROUPS_UNSUPPORTED_ERROR
          ? GROUPS_UNSUPPORTED_ERROR : 'client.groups.loadFailed');
      } finally { if (!cancelled && current === generation.current) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [model.client, model.ready, requestedPage, pageSize, search, revision]);
  const changePage = (page: number, pageSize: number) => {
    const nextPage = pageSize === paging.pageSize ? page : 1;
    if (nextPage === paging.page && pageSize === paging.pageSize) return;
    setLoading(true);
    setPaging(current => ({ ...current, page: nextPage, pageSize }));
  };
  const reload = () => { setLoading(true); setRevision(value => value + 1); };
  return { query, setQuery, loading: loading || query.trim() !== paging.search, error, result,
    page: result?.page ?? paging.page, pageSize: paging.pageSize, changePage, reload, viewport };
}
