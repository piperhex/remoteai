import { describe, expect, it } from 'vitest';
import { groupSyncThreads, uniqueSyncThreads, SYNC_RECENT_KEY }
  from '../../../../shared/conversation/sync/threadGroups';
import type { SyncThread } from '../../../../shared/conversation/sync/types';

const scratchId = '0300e13d-5059-40fe-925f-53e639c4f0cb';
const thread = (sessionId: string, cwd: string, updatedAt: number | null = null): SyncThread => ({
  sessionId, cwd, updatedAt, sessionKind: 'conversation', title: `Conversation ${sessionId}`,
  sizeBytes: 100, matchExcerpt: null,
});

describe('conversation synchronization groups', () => {
  it('merges older hosts rollout copies by ID without coupling distinct conversations with the same title', () => {
    const old = { ...thread('same-id', 'F:/old-project', 1), title: 'Same title', matchExcerpt: 'Archived match' };
    const latest = { ...thread('same-id', '', 3), title: 'Same title' };
    const other = { ...thread('other-id', '', 2), title: 'Same title' };
    const unique = uniqueSyncThreads([old, other, latest, latest]);
    expect(unique).toHaveLength(2);
    expect(unique[0]).toEqual({ ...latest, matchExcerpt: 'Archived match' });
    expect(uniqueSyncThreads([latest, old])[0]).toEqual(unique[0]);
    const [recent] = groupSyncThreads([old, other, latest]);
    expect(recent.key).toBe(SYNC_RECENT_KEY);
    expect(recent.children.map(item => item.sessionId)).toEqual(['same-id', 'other-id']);
    expect(new Set(recent.children.map(item => item.key)).size).toBe(2);
  });

  it('collects projectless conversations from different hosts in Recent and retains their names and paths', () => {
    const threads = [
      thread('empty', '', 1),
      thread('windows', `C:\\Users\\Codex\\AppData\\Roaming\\dev.codex.switch\\codex-gui-workspaces\\${scratchId}`, 3),
      thread('mac', `/Users/demo/Library/Application Support/dev.codex.switch/codex-gui-workspaces/${scratchId}`, 2),
      thread('linux', `/home/demo/.local/share/dev.codex.switch/codex-gui-workspaces/${scratchId}`),
      thread('extended', `\\\\?\\C:\\AppData\\CODEX-GUI-WORKSPACES\\${scratchId}\\`, 4),
    ];
    const [recent] = groupSyncThreads(threads);
    expect(recent.key).toBe(SYNC_RECENT_KEY);
    expect(recent.cwd).toBe('');
    expect(recent.updatedAt).toBe(4);
    expect(recent.children.map(item => item.sessionId)).toEqual(['extended', 'windows', 'mac', 'empty', 'linux']);
    expect(recent.children).toEqual(expect.arrayContaining(threads.map(item => expect.objectContaining(item))));
    expect(groupSyncThreads(threads)).toHaveLength(1);
  });

  it('keeps real projects separate and sorts each group and its conversations by update time', () => {
    const groups = groupSyncThreads([
      thread('recent', '', 2), thread('project-old', 'F:/projects/remoteai', 1),
      thread('project-new', 'F:/projects/remoteai', 5), thread('same-name', 'D:/clients/remoteai', 4),
      thread('similar-path', 'F:/projects/codex-gui-workspaces/not-a-scratch-id', 3),
      thread('similar-folder', `F:/projects/other-codex-gui-workspaces/${scratchId}`, 6),
    ]);
    expect(groups.map(group => group.cwd)).toEqual([
      `F:/projects/other-codex-gui-workspaces/${scratchId}`, 'F:/projects/remoteai',
      'D:/clients/remoteai', 'F:/projects/codex-gui-workspaces/not-a-scratch-id', '',
    ]);
    expect(groups[1].children.map(item => item.sessionId)).toEqual(['project-new', 'project-old']);
    expect(new Set(groups.map(group => group.key)).size).toBe(groups.length);
  });
});
