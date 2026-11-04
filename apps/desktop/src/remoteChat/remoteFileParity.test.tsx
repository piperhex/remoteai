// @vitest-environment jsdom
import { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { ChatMarkdown } from '../../../../shared/remote-chat/views/ChatMarkdown';
import { DetailsWorkspace } from '../../../../shared/conversation/DetailsWorkspace';
import { DetailsContext } from '../../../../shared/conversation/detailsContext';
import { FileEnvironmentContext, type FileEnvironment } from '../../../../shared/conversation/fileEnvironment';
import { FileThreadContext, fileApi } from '../../../../shared/conversation/fileApi';
import { filePreviewApi } from '../../../../shared/file-preview/workspace/api';
import type { FilePreviewData } from '../../../../shared/remote-chat/files';
import { remoteImageBytes } from '../../../../shared/remote-chat/views/remoteImageBytes';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
let environment: FileEnvironment;
const file: FilePreviewData = { sessionId: 'remote-session', path: 'F:/remote/docs/guide.md', name: 'guide.md',
  kind: 'markdown', text: '# Remote guide\n\n[Next](next.md#L3)\n\n![Photo](images/a.png)',
  url: 'http://127.0.0.1:54321/token/guide.md' };
const button = (text: string) => [...document.querySelectorAll('button')].find(node =>
  node.textContent === text || node.getAttribute('aria-label') === text)!;
const click = (text: string) => act(async () => button(text).click());
const render = async (text: string, value = environment) => act(async () => root.render(
  <FileEnvironmentContext.Provider value={value}><FileThreadContext.Provider value="remote-thread">
    <DetailsWorkspace selected="remote-thread" active><ChatMarkdown text={text} /></DetailsWorkspace>
  </FileThreadContext.Provider></FileEnvironmentContext.Provider>));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  vi.spyOn(fileApi, 'applications').mockResolvedValue([]);
  vi.spyOn(fileApi, 'perform').mockResolvedValue({ path: '/local', saved: false });
  vi.spyOn(filePreviewApi, 'open').mockResolvedValue(null);
  vi.spyOn(filePreviewApi, 'close').mockResolvedValue();
  vi.spyOn(message, 'error').mockImplementation(vi.fn());
  environment = { remote: true,
    actions: { applications: vi.fn(async () => []), perform: vi.fn(async target => ({ path: target.path, saved: false })) },
    previews: { open: vi.fn(async target => ({ ...file, sessionId: target.path, line: target.line })),
      close: vi.fn(async () => {}) },
    resolveWebsite: vi.fn(async () => 'http://127.0.0.1:54322/remote'),
    image: props => <img data-remote-image alt={props.alt} src="data:image/png;base64,YQ==" />,
  };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(fileApi.perform).not.toHaveBeenCalled(); expect(fileApi.applications).not.toHaveBeenCalled();
  expect(filePreviewApi.open).not.toHaveBeenCalled(); expect(filePreviewApi.close).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('uses the shared drawer and resolves nested files and images beside the remote document', async () => {
  await render('[Guide](F:/remote/docs/guide.md)'); await click('Guide');
  expect(host.querySelector('[data-details-panel]')?.textContent).toContain('Remote guide');
  expect(host.querySelector('img')?.src).toBe('http://127.0.0.1:54321/token/images/a.png');
  expect(button('源码')).toBeTruthy();
  await click('Next');
  expect(environment.previews.open).toHaveBeenLastCalledWith({ path: 'F:/remote/docs/next.md',
    line: 3, threadId: 'remote-thread' });
  expect(host.querySelector('.pm-browser-page:not([hidden]) [aria-pressed="true"]')?.textContent).toBe('源码');
  await click('返回上一页');
  expect(environment.previews.open).toHaveBeenCalledTimes(2);
  expect(host.querySelector('.pm-browser-page:not([hidden])')?.textContent).toContain('Remote guide');
});

it('shares table, code, review directives and image renderers in remote messages', async () => {
  await render('| A | B |\n|---|---|\n| one | two |\n\n```ts\nconst x = 1;\n```\n\n'
    + '::code-comment{title="Issue" body="Please review" file="F:/remote/a.ts" start=5 end=7}\n\n'
    + '![Remote image](F:/remote/a.png)');
  expect(host.querySelector('table')).toBeTruthy(); expect(button('自动换行')).toBeTruthy();
  expect(host.querySelector('[aria-label="代码审查意见"]')?.textContent).toContain('Please review');
  expect(host.querySelector('[data-remote-image]')).toBeTruthy();
});

it('routes localhost websites through the remote resolver before opening the shared drawer', async () => {
  await render('[Remote site](http://localhost:3000/remote)');
  await act(async () => host.querySelector('a')!.click());
  expect(environment.resolveWebsite).toHaveBeenCalledWith('http://localhost:3000/remote');
  expect(host.querySelector('iframe')?.src).toBe('http://127.0.0.1:54322/remote');
});

function ForwardedWebsiteLinks() {
  const panel = useContext(DetailsContext)!;
  const url = 'http://127.0.0.1:13000';
  return <>
    <button onClick={() => panel.openWebsite(url)}>Remote website</button>
    <button onClick={() => panel.openWebsite(url, { resolved: true })}>Forwarded website</button>
  </>;
}

it('keeps forwarded local addresses distinct from remote URLs throughout preview history', async () => {
  await act(async () => root.render(<FileEnvironmentContext.Provider value={environment}>
    <DetailsWorkspace selected="remote-thread" active><ForwardedWebsiteLinks /></DetailsWorkspace>
  </FileEnvironmentContext.Provider>));
  await click('Remote website');
  expect(host.querySelector('iframe')?.src).toBe('http://127.0.0.1:54322/remote');
  await click('Forwarded website');
  expect(host.querySelector<HTMLIFrameElement>('.pm-browser-page:not([hidden]) iframe')?.src)
    .toBe('http://127.0.0.1:13000/');
  expect(environment.resolveWebsite).toHaveBeenCalledTimes(1);
  await click('Remote website');
  expect(host.querySelector<HTMLIFrameElement>('.pm-browser-page:not([hidden]) iframe')?.src)
    .toBe('http://127.0.0.1:54322/remote');
  await click('Forwarded website');
  expect(host.querySelector<HTMLIFrameElement>('.pm-browser-page:not([hidden]) iframe')?.src)
    .toBe('http://127.0.0.1:13000/');
  expect(environment.resolveWebsite).toHaveBeenCalledTimes(1);
});

it.each([
  ['pdf', 'pdf'], ['audio', 'mp3'], ['audio', 'wav'], ['audio', 'flac'], ['video', 'ogg'], ['video', 'mp4'],
] as const)('uses the same %s preview content for %s files', async (kind, extension) => {
  vi.mocked(environment.previews.open).mockResolvedValue({ ...file, kind, text: null });
  await render(`[Media](F:/remote/media.${extension})`); await click('Media');
  if (kind === 'pdf') expect(host.querySelector('[data-resource-pdf]')).not.toBeNull();
  else expect(host.querySelector(kind)?.getAttribute('src')).toBe(file.url);
});

it.each(['msi', 'EXE', 'zip', 'docx', 'BIN'])(
  'shows a browser download card for remote %s files without previewing or discovering applications', async extension => {
    const path = `F:/remote/release.${extension}`;
    await render(`[Download](${path})`); await click('Download');
    expect(host.querySelector('.resource-download-card')?.textContent).toContain(`release.${extension}`);
    expect(host.querySelector('.website-preview-browser')).not.toBeNull();
    expect(environment.previews.open).not.toHaveBeenCalled();
    expect(environment.actions.applications).not.toHaveBeenCalled();
    expect(environment.actions.perform).not.toHaveBeenCalled();
    await click('下载');
    expect(environment.actions.perform).toHaveBeenCalledExactlyOnceWith(
      { path, threadId: 'remote-thread' }, { type: 'saveAs' },
    );
  },
);

it('keeps native file operations out of remote error handling and remote menus', async () => {
  vi.mocked(environment.previews.open).mockRejectedValue(new Error('Disconnected'));
  await render('[Guide](F:/remote/docs/guide.md)'); await click('Guide');
  expect(message.error).toHaveBeenCalled();
  expect(document.body.textContent).toContain('在远程电脑上打开');
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find(node => node.textContent === '在远程电脑上打开')!.click());
  expect(environment.actions.perform).toHaveBeenCalledWith({ path: 'F:/remote/docs/guide.md',
    threadId: 'remote-thread' }, { type: 'open', application: 'default' });
});

it('releases a late reply using the backend that opened it after switching computers', async () => {
  let finish!: (data: FilePreviewData) => void;
  vi.mocked(environment.previews.open).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render('[Guide](F:/remote/docs/guide.md)'); await click('Guide');
  const next = { ...environment, previews: { open: vi.fn(async () => file), close: vi.fn(async () => {}) } };
  await render('[Guide](F:/remote/docs/guide.md)', next);
  await act(async () => finish(file));
  expect(environment.previews.close).toHaveBeenCalledWith('remote-session');
  expect(next.previews.close).not.toHaveBeenCalled();
  expect(host.querySelector('[data-details-panel]')).toBeNull();
});

it('only supplies downloaded bytes to the local image clipboard and save actions', async () => {
  await expect(remoteImageBytes('F:/remote/image.png')).rejects.toThrow();
  await expect(remoteImageBytes('file:///F:/remote/image.png')).rejects.toThrow();
  await expect(remoteImageBytes('http://localhost/image.png')).rejects.toThrow();
  const fetch = vi.fn(async () => ({ blob: async () => new Blob(['image'], { type: 'image/png' }) }));
  vi.stubGlobal('fetch', fetch);
  expect(await remoteImageBytes('blob:downloaded-remote-image')).toBe('data:image/png;base64,aW1hZ2U=');
});
