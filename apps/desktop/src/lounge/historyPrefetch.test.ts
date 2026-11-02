import { expect, it } from 'vitest';
import { historyPrefetchDirection } from '../../../../shared/lounge/historyPrefetch';

it('preloads before either edge is reached in both history orders', () => {
  const options = { size: 40, hasOlder: true, hasNewer: true, newestFirst: true, first: 28, last: 35 };
  expect(historyPrefetchDirection(options)).toBe('older');
  expect(historyPrefetchDirection({ ...options, newestFirst: false })).toBe('newer');
  expect(historyPrefetchDirection({ ...options, first: 3, last: 10 })).toBe('newer');
  expect(historyPrefetchDirection({ ...options, first: 12, last: 20 })).toBeUndefined();
});

it('does not churn between opposing edges in small image-heavy windows without a user gesture', () => {
  const options = { size: 3, hasOlder: true, hasNewer: true, newestFirst: true, first: 0, last: 2 };
  expect(historyPrefetchDirection(options)).toBeUndefined();
  expect(historyPrefetchDirection({ ...options, intent: 'older' })).toBe('older');
  expect(historyPrefetchDirection({ ...options, intent: 'newer' })).toBe('newer');
  expect(historyPrefetchDirection({ ...options, intent: 'older', hasOlder: false })).toBeUndefined();
});

it('still accepts newly arriving messages in a short conversation without treating evicted records as new arrivals', () => {
  expect(historyPrefetchDirection({ size: 2, first: 0, last: 1, hasOlder: false, hasNewer: true,
    newerArrived: true, newestFirst: true })).toBe('newer');
});
