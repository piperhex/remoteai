// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { canScrollWithin } from '../../../../../shared/chat/canScrollWithin';

afterEach(() => document.body.replaceChildren());

function nestedScrollers() {
  const history = document.createElement('div');
  const activity = document.createElement('div');
  const output = document.createElement('div');
  const text = document.createElement('span');
  for (const node of [history, activity, output]) {
    node.style.overflowY = 'auto';
    Object.defineProperties(node, { scrollHeight: { value: 600 }, clientHeight: { value: 200 } });
  }
  history.append(activity); activity.append(output); output.append(text); document.body.append(history);
  return { history, activity, output, text };
}

it.each([-120, 120])('keeps history idle until every nested viewport reaches the %s boundary', delta => {
  const { history, activity, output, text } = nestedScrollers();
  output.scrollTop = 200; activity.scrollTop = 200;
  expect(canScrollWithin(text, history, delta)).toBe(true);
  output.scrollTop = delta < 0 ? 0 : 400;
  expect(canScrollWithin(text, history, delta)).toBe(true);
  activity.scrollTop = delta < 0 ? 0 : 400;
  expect(canScrollWithin(text, history, delta)).toBe(false);
  expect(canScrollWithin(text, history, -delta)).toBe(true);
});

it('ignores clipped content and excludes the history viewport itself', () => {
  const { history, activity, output, text } = nestedScrollers();
  output.style.overflowY = 'hidden'; activity.style.overflowY = 'visible';
  expect(canScrollWithin(text, history, 120)).toBe(false);
  expect(canScrollWithin(history, history, 120)).toBe(false);
});
