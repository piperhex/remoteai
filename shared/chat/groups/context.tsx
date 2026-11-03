import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { MessageTranslator } from '../../localization/messages';
import { EMPTY_GROUPING, GROUPS_UNSUPPORTED_ERROR, type GroupClient, type Grouping, type GroupMember, type GroupMutation,
  type GroupTarget } from './model';

export function useGroupingUI(options: {
  grouping?: Grouping; client: GroupClient; translate: MessageTranslator; ready: boolean; lazyMembers?: boolean;
}) {
  const [managerOpen, setManagerOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<GroupTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(false);
  const flight = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, [options.client]);
  const perform = async (operation: () => Promise<void>): Promise<boolean> => {
    if (flight.current || !options.ready) return false;
    flight.current = true;
    setBusy(true); setError('');
    try { await operation(); return true; }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : 'client.groups.saveFailed');
      return false;
    } finally { flight.current = false; setBusy(false); }
  };
  const run = (mutation: GroupMutation) => perform(() => options.client.mutate(mutation));
  const reload = async () => {
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await options.client.members();
      if (generation.current === current) setMembers(result);
    } catch (failure) {
      if (generation.current === current) setError(failure instanceof Error
        && failure.message === GROUPS_UNSUPPORTED_ERROR ? GROUPS_UNSUPPORTED_ERROR : 'client.groups.loadFailed');
    }
    finally { if (generation.current === current) setLoading(false); }
  };
  const closeManager = () => {
    // A dismissed manager owns its load errors, including replies that arrive after closing.
    generation.current += 1;
    setManagerOpen(false); setError(''); setLoading(false);
  };
  const openManager = () => {
    setMoveTarget(null); setManagerOpen(true);
    if (!options.lazyMembers) void reload();
  };
  const assign = async (targets: GroupTarget[], groupId: string | null) => {
    const success = await run({ action: 'assign', targets, groupId });
    if (success) setMoveTarget(null);
    return success;
  };
  return { ...options, grouping: options.grouping ?? EMPTY_GROUPING, managerOpen, closeManager,
    moveTarget, setMoveTarget, busy, error, setError, members, loading, reload, run, perform, assign, openManager };
}

export type GroupingUI = ReturnType<typeof useGroupingUI>;
export const GroupingContext = createContext<GroupingUI | null>(null);
export const useGrouping = () => useContext(GroupingContext);
