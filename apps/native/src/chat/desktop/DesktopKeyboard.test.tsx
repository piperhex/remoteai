import React, { Children, isValidElement, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopKeyboard } from './DesktopKeyboard';

const runtime = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: <T,>(initial: T) => {
    const slot = runtime.index++;
    if (!(slot in runtime.values)) runtime.values[slot] = initial;
    return [runtime.values[slot], (next: SetStateAction<T>) => {
      runtime.values[slot] = typeof next === 'function'
        ? (next as (value: T) => T)(runtime.values[slot] as T) : next;
    }];
  },
}));
vi.mock('react-native', () => ({ View: 'View', Pressable: 'Pressable', Text: 'Text', ScrollView: 'ScrollView',
  Keyboard: { dismiss: vi.fn() }, StyleSheet: { create: <T,>(styles: T) => styles } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('../../i18n', () => ({ t: (text: string) => text, useLanguage: vi.fn() }));
vi.mock('./DesktopIme', () => ({ DesktopIme: 'DesktopIme' }));

interface Props {
  children?: ReactNode; accessibilityLabel?: string; accessibilityState?: { selected?: boolean };
  disabled?: boolean; onPress?: () => void;
}
function nodes(tree: ReactNode): ReactElement<Props>[] {
  return Children.toArray(tree).flatMap(child => isValidElement<Props>(child)
    ? [child, ...nodes(child.props.children)] : []);
}
function setup(compact: boolean) {
  const input = vi.fn();
  const button = (label: string) => {
    runtime.index = 0;
    const tree = DesktopKeyboard({ input, close: vi.fn(), compact, supported: true });
    const node = nodes(tree).find(node => node.props.accessibilityLabel === label);
    expect(node, label).toBeDefined();
    return node!.props;
  };
  const press = (label: string) => {
    const props = button(label);
    expect(props.disabled).not.toBe(true);
    props.onPress!();
  };
  return { input, button, press };
}
beforeEach(() => { runtime.values = []; runtime.index = 0; vi.stubGlobal('React', React); });
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('sends the same lock chord from both native keyboard tabs (compact: %s)', compact => {
  const { input, button, press } = setup(compact);
  const chord = [
    { kind: 'keyboard', code: 'MetaLeft', down: true }, { kind: 'keyboard', code: 'KeyL', down: true },
    { kind: 'keyboard', code: 'KeyL', down: false }, { kind: 'keyboard', code: 'MetaLeft', down: false },
  ];
  press('快捷键'); press('Win+L 锁定屏幕');
  expect(input.mock.calls.map(([event]) => event)).toEqual(chord);
  press('电脑键盘'); press('组合键模式'); press('Win');
  expect(button('Win').accessibilityState?.selected).toBe(true);
  expect(input).toHaveBeenCalledTimes(chord.length);
  press('L');
  expect(input.mock.calls.map(([event]) => event)).toEqual([...chord, ...chord]);
  expect(button('Win').accessibilityState?.selected).toBe(false);
  press('L');
  expect(input.mock.calls.slice(-2).map(([event]) => event)).toEqual([
    { kind: 'keyboard', code: 'KeyL', down: true }, { kind: 'keyboard', code: 'KeyL', down: false },
  ]);
});
