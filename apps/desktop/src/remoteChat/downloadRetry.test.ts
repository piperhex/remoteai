import { expect, it } from 'vitest';
import { DownloadRetry } from '../../../../shared/remote-chat/downloadRetry';

it('stops recovery without progress, resets only for verified progress or explicit resumption, and isolates tasks', () => {
  const retries = new DownloadRetry();
  expect(retries.next('first', 1024)).toBe(1000);
  expect(retries.next('first', 1024)).toBe(2000);
  expect(retries.next('first', 0)).toBe(4000);
  expect(retries.next('first', 0)).toBeUndefined();
  expect(retries.next('second', 0)).toBe(1000);
  expect(retries.next('first', 2048)).toBe(1000);
  retries.clear('first');
  expect(retries.next('first', 2048)).toBe(1000);
});
