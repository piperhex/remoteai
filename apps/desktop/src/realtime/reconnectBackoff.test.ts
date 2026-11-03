import { expect, it } from 'vitest';
import { ReconnectBackoff } from '../../../../shared/realtime/reconnectBackoff';

it('doubles the window, caps it indefinitely, and resets after success', () => {
  const backoff = new ReconnectBackoff({ initialMs: 1500, random: () => 1 });
  expect(Array.from({ length: 7 }, () => backoff.next())).toEqual([1500, 3000, 6000, 12000, 24000, 30000, 30000]);
  for (let failure = 0; failure < 10_000; failure++) expect(backoff.next()).toBe(30_000);
  backoff.reset(); expect(backoff.next()).toBe(1500);
});

it('spreads independent clients over the upper half of every window, including the cap', () => {
  const clients = [0, 0.25, 0.5, 0.75, 1].map(random => new ReconnectBackoff({ random: () => random }));
  for (const ceiling of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const delays = clients.map(client => client.next());
    expect(new Set(delays).size).toBe(5);
    expect(Math.min(...delays)).toBe(ceiling / 2);
    expect(Math.max(...delays)).toBe(ceiling);
  }
});
