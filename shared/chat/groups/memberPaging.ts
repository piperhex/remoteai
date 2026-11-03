import { GROUPS_UNSUPPORTED_ERROR, type GroupMembersPage, type GroupMembersQuery } from './model';

export const GROUP_PAGE_SIZES = [20, 50, 100];
export const DEFAULT_GROUP_PAGE_SIZE = GROUP_PAGE_SIZES[0];
const MAX_SEARCH_LENGTH = 1000;

export function readMembersQuery(input: unknown): GroupMembersQuery {
  if (!input || typeof input !== 'object') throw new Error('client.groups.loadFailed');
  const query = input as Partial<GroupMembersQuery>;
  if (!Number.isSafeInteger(query.page) || query.page! < 1 || query.page! > 1_000_000
    || !GROUP_PAGE_SIZES.includes(query.pageSize!) || typeof query.search !== 'string'
    || query.search.length > MAX_SEARCH_LENGTH) throw new Error('client.groups.loadFailed');
  return { page: query.page!, pageSize: query.pageSize!, search: query.search.trim() };
}

export function readMembersPage(input: unknown): GroupMembersPage {
  // Hosts predating this action may reply with a sidebar snapshot instead of a page.
  if (!input || typeof input !== 'object' || !('data' in input)) throw new Error(GROUPS_UNSUPPORTED_ERROR);
  const page = input as GroupMembersPage;
  readMembersQuery({ ...page, search: '' });
  if (!Array.isArray(page.data) || page.data.length > page.pageSize || !Number.isSafeInteger(page.total)
    || page.total < 0 || page.data.some(row => !row || !['project', 'thread'].includes(row.kind)
      || typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.cwd !== 'string')) {
    throw new Error('client.groups.loadFailed');
  }
  return page;
}
