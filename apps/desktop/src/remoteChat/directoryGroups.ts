import { getGuiController } from '../pages/codexGui/session';
import { guiApi } from '../../../../shared/conversation/api';
import type { Thread } from '../../../../shared/conversation/types';
import { DIRECTORY_PAGE_SIZE } from '../../../../shared/chat/directory/protocol';
import { directoryScope, readDirectoryQuery } from '../../../../shared/chat/directory/documents';
import { memberGroup } from '../../../../shared/chat/groups/model';

const GROUP_CURSOR = 'group-directory:';
const MEMBER_SCAN_SIZE = 100;

/** The member index is scanned on the host; only one bounded summary page crosses the connection. */
export async function readGroupDirectoryPage(body: Record<string, unknown>, controller = getGuiController()) {
  const query = readDirectoryQuery(body);
  const scope = directoryScope(query);
  let after = '';
  if (body.cursor) {
    if (typeof body.cursor !== 'string' || !body.cursor.startsWith(GROUP_CURSOR)) throw new Error('Invalid request');
    const cursor = JSON.parse(body.cursor.slice(GROUP_CURSOR.length)) as { scope: string; after: string };
    if (cursor.scope !== scope || typeof cursor.after !== 'string') throw new Error('Invalid request');
    after = cursor.after;
  }
  const grouping = controller.getSnapshot().grouping;
  const ids = new Set(Object.entries(grouping.threads).filter(([, group]) => group === query.groupId).map(([id]) => id));
  if (Object.values(grouping.projects).includes(query.groupId!)) {
    let page = 1;
    while (true) {
      const members = await controller.groups.membersPage!({ page, pageSize: MEMBER_SCAN_SIZE, search: query.search });
      for (const member of members.data) {
        if (member.kind === 'thread' && memberGroup(grouping, member) === query.groupId) ids.add(member.id);
      }
      if (page++ * members.pageSize >= members.total) break;
    }
  }
  const remaining = [...ids].sort().filter(id => id > after);
  const data: Thread[] = [];
  let scanned = 0;
  while (scanned < remaining.length && data.length < DIRECTORY_PAGE_SIZE) {
    const selected = remaining.slice(scanned, scanned + DIRECTORY_PAGE_SIZE - data.length);
    const threads = await guiApi.request<Thread[]>({ operation: 'groupThreadSummaries',
      threadIds: selected, archived: query.archived });
    data.push(...threads.filter(thread => !query.search || `${thread.name ?? ''} ${thread.preview}`
      .toLowerCase().includes(query.search.toLowerCase())));
    scanned += selected.length;
  }
  return { data, nextCursor: scanned < remaining.length
    ? GROUP_CURSOR + JSON.stringify({ scope, after: remaining[scanned - 1] }) : null };
}
