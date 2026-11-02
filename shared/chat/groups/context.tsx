import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { MessageTranslator } from '../../localization/messages';
import { EMPTY_GROUPING, type GroupClient, type Grouping, type GroupMember, type GroupMutation,
  type GroupTarget } from './model';

export function useGroupingUI(options: {
  grouping?: Grouping; client: GroupClient; translate: MessageTranslator; ready: boolean;
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
  const run = async (mutation: GroupMutation): Promise<boolean> => {
    if (flight.current || !options.ready) return false;
    flight.current = true;
    setBusy(true); setError('');
    try { await options.client.mutate(mutation); return true; }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : 'client.groups.saveFailed');
      return false;
    } finally { flight.current = false; setBusy(false); }
  };
  const reload = async () => {
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await options.client.members();
      if (generation.current === current) setMembers(result);
    } catch { if (generation.current === current) setError('client.groups.loadFailed'); }
    finally { if (generation.current === current) setLoading(false); }
  };
  const openManager = () => { setMoveTarget(null); setManagerOpen(true); void reload(); };
  const assign = async (targets: GroupTarget[], groupId: string | null) => {
    const success = await run({ action: 'assign', targets, groupId });
    if (success) setMoveTarget(null);
    return success;
  };
  return { ...options, grouping: options.grouping ?? EMPTY_GROUPING, managerOpen, setManagerOpen,
    moveTarget, setMoveTarget, busy, error, setError, members, loading, reload, run, assign, openManager };
}

export type GroupingUI = ReturnType<typeof useGroupingUI>;
export const GroupingContext = createContext<GroupingUI | null>(null);
export const useGrouping = () => useContext(GroupingContext);
