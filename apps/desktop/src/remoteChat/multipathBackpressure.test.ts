import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChannelBackpressureError } from '../../../../shared/remote-chat/channelBackpressure';
import { MultipathChannel } from '../../../../shared/remote-chat/multipathChannel';
import type { Channel } from '../../../../shared/remote-chat/protocol';

const PROBE_MS = 1000;
const PATH_TIMEOUT_MS = 3000;
const channels = new Set<MultipathChannel>();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
afterEach(() => {
  channels.forEach(channel => channel.close());
  channels.clear();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

function directPath() {
  let receive = (_text: string) => {};
  let failure: Error | undefined;
  let answerProbes = true;
  const send = vi.fn((text: string) => {
    if (failure) throw failure;
    const [kind, sequence] = JSON.parse(text) as [string, number];
    if (kind === 'ping' && answerProbes) receive(JSON.stringify(['pong', sequence]));
  });
  const channel: Channel = { readyState: 'open', bufferedAmount: 0, send,
    onMessage: callback => { receive = callback; }, onOpen: vi.fn(), onClose: vi.fn(), close: vi.fn() };
  return { channel, send, failWith: (error?: Error) => { failure = error; },
    silence: () => { answerProbes = false; }, ping: () => receive(JSON.stringify(['ping', 99])) };
}

function multipath() {
  const disconnected = vi.fn(), stateChanged = vi.fn(), diagnostic = vi.fn();
  const channel = new MultipathChannel({ disconnected, stateChanged, diagnostic });
  channels.add(channel);
  const native = directPath();
  channel.add(native.channel, 0, 'mesh');
  expect(channel.readyState).toBe('open');
  return { channel, native, disconnected, stateChanged, diagnostic };
}

it.each(['ping', 'pong'] as const)('preserves path health when sending %s encounters backpressure', frame => {
  const { channel, native, disconnected, stateChanged } = multipath();
  const congestion = new ChannelBackpressureError();
  native.failWith(congestion);
  if (frame === 'ping') vi.advanceTimersByTime(PROBE_MS);
  else native.ping();
  expect(native.send.mock.results.at(-1)).toEqual({ type: 'throw', value: congestion });

  // Let the next selection run without a fresh pong masking an incorrectly cleared heartbeat.
  native.failWith(); native.silence();
  vi.advanceTimersByTime(PROBE_MS);
  expect(channel.readyState).toBe('open');
  expect(disconnected).not.toHaveBeenCalled();
  expect(stateChanged.mock.calls).toEqual([['connected']]);
  channel.send('after queue drains');
  expect(native.send).toHaveBeenLastCalledWith(JSON.stringify(['data', 'after queue drains']));
});

it('still expires the last successful heartbeat when congestion persists', () => {
  const { channel, native, disconnected } = multipath();
  native.failWith(new ChannelBackpressureError());
  vi.advanceTimersByTime(PATH_TIMEOUT_MS - 1);
  expect(channel.readyState).toBe('open');
  expect(disconnected).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(channel.readyState).toBe('connecting');
  expect(disconnected).toHaveBeenCalledOnce();
  expect(native.channel.close).not.toHaveBeenCalled();
  expect(() => channel.send('expired')).toThrow('Direct paths unavailable');
});

it.each(['ping', 'pong'] as const)('invalidates path health when sending %s actually fails', frame => {
  const { channel, native, disconnected, stateChanged } = multipath();
  const failure = new Error('Writer disconnected');
  native.failWith(failure);
  if (frame === 'ping') vi.advanceTimersByTime(PROBE_MS);
  else native.ping();
  expect(native.send.mock.results.at(-1)).toEqual({ type: 'throw', value: failure });
  native.failWith(); native.silence();
  vi.advanceTimersByTime(PROBE_MS);
  expect(channel.readyState).toBe('connecting');
  expect(disconnected).toHaveBeenCalledOnce();
  expect(stateChanged.mock.calls).toEqual([['connected'], ['disconnected']]);
});

it('keeps the selected native route when another healthy direct route is available', () => {
  const { channel, native, disconnected, diagnostic } = multipath();
  const rtc = directPath();
  channel.add(rtc.channel, 1, 'rtc');
  native.failWith(new ChannelBackpressureError());
  vi.advanceTimersByTime(PROBE_MS);
  native.failWith();
  channel.send('same route');
  expect(native.send).toHaveBeenLastCalledWith(JSON.stringify(['data', 'same route']));
  expect(disconnected).not.toHaveBeenCalled();
  expect(diagnostic).toHaveBeenCalledTimes(1);
});
