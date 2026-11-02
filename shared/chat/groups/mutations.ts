import { GROUP_ICON_LIMIT, GROUP_LIMIT, GROUP_NAME_LIMIT, emptyGrouping, isDescendant,
  type ChatGroup, type Grouping, type GroupMutation, type GroupTarget } from './model';

const invalid = () => new Error('client.groups.invalid');
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value);

/** Only normalized 128px PNG images may cross the shared sidebar boundary. */
export function validGroupIcon(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  if (typeof value !== 'string' || value.length > GROUP_ICON_LIMIT) return false;
  // Icons produced by both platform adapters are PNG. Check IHDR dimensions without decoding an image.
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const header = atob(value.slice(value.indexOf(',') + 1, value.indexOf(',') + 45));
    return header.slice(1, 4) === 'PNG' && header.slice(12, 16) === 'IHDR'
      && [16, 20].every(offset => header.charCodeAt(offset) === 0 && header.charCodeAt(offset + 1) === 0
        && header.charCodeAt(offset + 2) === 0 && header.charCodeAt(offset + 3) === 128);
  } catch { return false; }
}

function validateGroup(group: ChatGroup, groups: ChatGroup[]) {
  if (!validId(group.id) || typeof group.name !== 'string' || !group.name.trim()
    || group.name.trim().length > GROUP_NAME_LIMIT || !validGroupIcon(group.icon)) throw invalid();
  if (group.parentId !== null && (!validId(group.parentId)
    || !groups.some(entry => entry.id === group.parentId)
    || isDescendant(groups, group.parentId, group.id))) throw invalid();
  if (groups.some(entry => entry.id !== group.id && entry.parentId === group.parentId
    && entry.name.toLocaleLowerCase() === group.name.trim().toLocaleLowerCase())) {
    throw new Error('client.groups.duplicateName');
  }
}

function validateTargets(targets: GroupTarget[]) {
  if (!Array.isArray(targets) || !targets.length || targets.length > 10_000) throw invalid();
  for (const target of targets) {
    if (!record(target) || !['project', 'thread'].includes(target.kind)
      || typeof target.id !== 'string' || !target.id.trim() || target.id.length > 4096
      || target.id.includes('\0') || (target.kind === 'thread' && !validId(target.id))) throw invalid();
  }
}

/** Apply operations to the latest host state so concurrent clients never replace unrelated edits. */
export function mutateGrouping(state: Grouping, input: unknown): Grouping {
  if (!record(input)) throw invalid();
  const mutation = input as unknown as GroupMutation;
  const next: Grouping = { groups: [...state.groups], projects: { ...state.projects }, threads: { ...state.threads } };
  if (mutation.action === 'assign') {
    validateTargets(mutation.targets);
    if (mutation.groupId !== null && !next.groups.some(group => group.id === mutation.groupId)) throw invalid();
    mutation.targets.forEach(target => { next[target.kind === 'project' ? 'projects' : 'threads'][target.id]
      = mutation.groupId; });
    return next;
  }
  if (mutation.action === 'create') {
    if (!record(mutation.group) || next.groups.length >= GROUP_LIMIT
      || next.groups.some(group => group.id === mutation.group.id)) throw invalid();
    validateGroup(mutation.group, next.groups);
    const { id, name, parentId, icon } = mutation.group;
    next.groups.push({ id, name: name.trim(), parentId, icon });
    return next;
  }
  const existing = next.groups.find(group => group.id === mutation.id);
  if (!existing) throw invalid();
  if (mutation.action === 'edit') {
    const group = { id: existing.id, name: mutation.name, parentId: mutation.parentId, icon: mutation.icon };
    validateGroup(group, next.groups);
    next.groups = next.groups.map(entry => entry.id === group.id ? { ...group, name: group.name.trim() } : entry);
  } else if (mutation.action === 'delete') {
    next.groups = next.groups.filter(group => group.id !== existing.id)
      .map(group => group.parentId === existing.id ? { ...group, parentId: existing.parentId } : group);
    next.groups.forEach(group => validateGroup(group, next.groups));
    for (const map of [next.projects, next.threads]) {
      Object.keys(map).forEach(id => { if (map[id] === existing.id) map[id] = existing.parentId; });
    }
  } else throw invalid();
  return next;
}

export function readGrouping(value: unknown): Grouping {
  if (!record(value) || !Array.isArray(value.groups)) return emptyGrouping();
  try {
    const state = value as unknown as Grouping;
    if (state.groups.length > GROUP_LIMIT || new Set(state.groups.map(group => group.id)).size !== state.groups.length) {
      return emptyGrouping();
    }
    state.groups.forEach(group => validateGroup(group, state.groups));
    const memberships = (map: unknown) => Object.fromEntries(Object.entries(record(map) ? map : {})
      .filter((entry): entry is [string, string | null] => entry[1] === null
        || (typeof entry[1] === 'string' && state.groups.some(group => group.id === entry[1]))));
    return { groups: state.groups, projects: memberships(state.projects), threads: memberships(state.threads) };
  } catch { return emptyGrouping(); }
}
