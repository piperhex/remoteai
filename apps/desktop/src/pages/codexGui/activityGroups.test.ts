import { expect, it } from 'vitest';
import { groupConsecutiveActivities } from '../../../../../shared/conversation/activityGroups';
import type { Item } from '../../../../../shared/conversation/types';

const command = (id: string): Item => ({ id, type: 'commandExecution', status: 'completed' });
const empty: Item[] = [
  { id: 'hidden', type: 'reasoning', summary: [], content: [] },
  { id: 'whitespace', type: 'reasoning', summary: [' ', '\n'] },
  { id: 'comment', type: 'agentMessage', phase: 'commentary', text: ' \n ' },
];

it('groups visible commands across empty records returned by deferred history', () => {
  const groups = groupConsecutiveActivities([command('first'), ...empty, command('last')]);
  expect(groups).toEqual([{ key: 'first', activity: true, items: [command('first'), command('last')] }]);
  expect(groupConsecutiveActivities(empty)).toEqual([]);
});

it.each([
  { id: 'explanation', type: 'agentMessage', phase: 'commentary', text: 'Checking the result.' },
  { id: 'reasoning', type: 'reasoning', summary: ['Compare the two results.'] },
] satisfies Item[])('preserves a visible $type between command groups', item => {
  const groups = groupConsecutiveActivities([command('first'), ...empty, item, command('last')]);
  expect(groups.map(group => group.items.map(entry => entry.id))).toEqual([['first'], [item.id], ['last']]);
  expect(groups[1].activity).toBe(false);
});
