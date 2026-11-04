// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../../api/backend';
import { ChatGptLaunchPathCard } from './ChatGptLaunchPathCard';
import type { ChatGptLaunchPathSettings } from '../../api/chatgptLaunchPath';

vi.mock('../../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
let root: Root;
let container: HTMLDivElement;
let settings: ChatGptLaunchPathSettings;
const input = () => container.querySelector<HTMLInputElement>('#chatgpt-launch-path')!;
const button = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const render = () => act(async () => root.render(<ChatGptLaunchPathCard language="zh" />));

async function edit(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const save = () => act(async () => button().click());

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
  settings = { manualPath: null, detectedPath: 'C:\\Program Files\\ChatGPT\\ChatGPT.exe' };
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    if (command === 'set_chatgpt_launch_path') {
      settings.manualPath = (args!.path as string).trim() || null;
      return settings.manualPath;
    }
    return settings;
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('shows discovery only as a placeholder, persists manual edits and clears back to automatic mode', async () => {
  await render();
  expect(input().value).toBe('');
  expect(input().placeholder).toBe(settings.detectedPath);
  expect(button().disabled).toBe(true);
  await edit('D:\\My Apps\\ChatGPT.exe');
  await save();
  expect(invoke).toHaveBeenLastCalledWith('set_chatgpt_launch_path', { path: 'D:\\My Apps\\ChatGPT.exe' });
  expect(container.textContent).toContain('已保存');
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(input().value).toBe('D:\\My Apps\\ChatGPT.exe');
  await edit('');
  await save();
  expect(settings.manualPath).toBeNull();
  expect(input().value).toBe('');
  expect(input().placeholder).toBe(settings.detectedPath);
});

it('keeps an invalid edit available for correction without exposing internal errors', async () => {
  await render();
  await edit('missing.exe');
  vi.mocked(invoke).mockRejectedValueOnce('invalid');
  await save();
  expect(input().value).toBe('missing.exe');
  expect(container.textContent).toContain('请选择有效的 ChatGPT');
  vi.mocked(invoke).mockRejectedValueOnce(new Error('secret filesystem details'));
  await save();
  expect(container.textContent).toContain('暂时无法保存启动路径');
  expect(container.textContent).not.toContain('secret filesystem details');
  expect(settings.manualPath).toBeNull();
});

it('allows manual configuration when discovery finds nothing', async () => {
  settings.detectedPath = null;
  await render();
  expect(input().placeholder).toContain('未找到 ChatGPT');
  expect(input().disabled).toBe(false);
  await edit('D:\\ChatGPT.exe');
  await save();
  expect(settings.manualPath).toBe('D:\\ChatGPT.exe');
});

it('prevents overwriting a preference that failed to load', async () => {
  vi.mocked(invoke).mockRejectedValueOnce('load');
  await render();
  expect(input().disabled).toBe(true);
  expect(button().disabled).toBe(true);
  expect(container.textContent).toContain('暂时无法读取启动路径');
});

it('keeps saves single-flight while the backend is busy', async () => {
  await render();
  await edit('D:\\ChatGPT.exe');
  let complete!: (path: string) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await save();
  await save();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(input().disabled).toBe(true);
  await act(async () => complete('D:\\ChatGPT.exe'));
  expect(button().disabled).toBe(true);
});
