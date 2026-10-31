import { useContext, useState } from 'react';
import { WorkspaceDrawerContext } from '../../../../shared/chat/workspaceDrawer';
import type { Turn } from './types';
import type { TurnPanel } from './ChatTurnSummary';
import { ChatToolDetails } from './ChatToolDetails';
import { ChatTurnDetails } from './ChatTurnDetails';

type WorkSelection = { type: 'work' | 'activities'; id: string };
export type HistorySelection = WorkSelection | { type: 'item'; id: string }
  | { type: 'turn'; id: string; panel: TurnPanel };
type DrawerSelection = Exclude<HistorySelection, WorkSelection>;
const tabId = (selection: DrawerSelection) =>
  `history:${selection.type}:${selection.id}:${selection.type === 'turn' ? selection.panel : 'changes'}`;

function isDrawer(selection: HistorySelection, turns: Turn[]): selection is DrawerSelection {
  if (selection.type === 'turn') return selection.panel === 'changes' || selection.panel === 'result';
  return selection.type === 'item'
    && turns.some(turn => turn.items.some(item => item.id === selection.id && item.type === 'fileChange'));
}

/** Keep right-hand history details mounted even when another message or tool is selected. */
export function useHistoryDrawers(turns: Turn[]) {
  const workspace = useContext(WorkspaceDrawerContext);
  const [visited, setVisited] = useState<DrawerSelection[]>([]);
  const open = (selection: HistorySelection) => {
    if (!workspace || !isDrawer(selection, turns)) return false;
    const id = tabId(selection);
    setVisited(current => current.some(entry => tabId(entry) === id) ? current : [...current, selection]);
    workspace.tabs.open(id);
    return true;
  };
  const close = () => workspace?.tabs.hide();
  const panels = visited.map(selection => {
    const id = tabId(selection);
    if (selection.type === 'turn') {
      const turn = turns.find(turn => turn.id === selection.id);
      return turn && <ChatTurnDetails key={id} tabId={id} turn={turn} panel={selection.panel} onClose={close} />;
    }
    const item = turns.flatMap(turn => turn.items).find(item => item.id === selection.id);
    return item && <ChatToolDetails key={id} tabId={id} item={item} onClose={close} />;
  });
  return { open, panels };
}
