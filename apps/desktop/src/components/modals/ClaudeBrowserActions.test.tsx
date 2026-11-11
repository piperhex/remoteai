// @vitest-environment jsdom
import { act } from 'react';
import { ConfigProvider } from 'antd';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClaudeBrowserActions } from '../../../../../shared/accounts/ClaudeBrowserActions';

const runtime = vi.hoisted(() => ({ desktop: true, invoke: vi.fn(), copy: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', () => ({
  get isDesktopApp() { return runtime.desktop; }, invoke: runtime.invoke,
}));
vi.mock('../../../../../shared/clipboard', () => ({ copyText: runtime.copy }));
vi.mock('../../../../../shared/localization/uiText', () => ({ uiText: (key: string) => key }));
let root: Root;
let container: HTMLDivElement;
const url = 'https://claude.com/cai/oauth/authorize?state=fixture';
const button = (key: string) => [...document.querySelectorAll('button')]
  .find(item => item.textContent?.includes(`client.officialAccounts.${key}`))!;
const click = async (key: string) => act(async () => { button(key).click(); });

beforeEach(() => {
  vi.clearAllMocks(); runtime.desktop = true; runtime.invoke.mockResolvedValue(true);
  runtime.copy.mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => computed(element));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <ClaudeBrowserActions url={url} />
  </ConfigProvider>));
}

it('waits for the choice and sends the selected private mode to the local browser command', async () => {
  await render(); expect(runtime.invoke).not.toHaveBeenCalled();
  const buttons = [...document.querySelectorAll('.ant-modal-footer button')];
  expect(buttons.map(item => item.textContent)).toEqual([
    'client.officialAccounts.browserNormal', 'client.officialAccounts.browserPrivate',
  ]);
  await click('browserPrivate');
  expect(runtime.invoke).toHaveBeenCalledExactlyOnceWith('open_claude_authorization', { url, privateMode: true });
  await render(); expect(runtime.invoke).toHaveBeenCalledTimes(1);
  await click('openBrowser'); await click('browserNormal');
  expect(runtime.invoke).toHaveBeenLastCalledWith('open_claude_authorization', { url, privateMode: false });
});

it('offers a copyable link when private launch is unsupported, without opening a regular window', async () => {
  runtime.invoke.mockResolvedValue(false);
  await render(); await click('browserPrivate');
  expect(runtime.invoke).toHaveBeenCalledTimes(1);
  expect(document.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(url);
  await click('copyLink'); expect(runtime.copy).toHaveBeenCalledWith(url);
  expect(button('linkCopied')).toBeDefined();
});

it('opens regular Web authorization only on click and offers manual private opening', async () => {
  runtime.desktop = false;
  const opened = vi.spyOn(window, 'open').mockReturnValue(null);
  await render(); expect(opened).not.toHaveBeenCalled();
  await click('browserPrivate'); expect(opened).not.toHaveBeenCalled();
  expect(runtime.invoke).not.toHaveBeenCalled();
  await click('openBrowser'); await click('browserNormal');
  expect(opened).toHaveBeenCalledExactlyOnceWith(url, '_blank', 'noopener,noreferrer');
});
