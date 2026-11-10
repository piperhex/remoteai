// @vitest-environment jsdom
import { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DetailsWorkspace, type RemoteFilePreviewProps } from '../../../../shared/conversation/DetailsWorkspace';
import { DetailsContext } from '../../../../shared/conversation/detailsContext';
import { FileEnvironmentContext, type FileEnvironment } from '../../../../shared/conversation/fileEnvironment';
import { filePreviewApi } from '../../../../shared/file-preview/workspace/api';
import { BrowserClientContext } from '../../../../shared/file-preview/workspace/browserClient';
import { ChatFilePreview, ChatFilePreviewContent, type FilePreviewContext }
  from '../../../../shared/remote-chat/views/ChatFilePreview';
import { ChatRemoteFilePreview } from '../../../../shared/remote-chat/views/ChatRemoteFilePreview';

vi.mock('../../../../shared/file-preview/PdfUrlPreview', () => ({
  PdfUrlPreview: ({ url }: { url: string }) => <div data-pdf-preview={url} />,
}));

const target = { path: 'F:/remote/report.PDF', threadId: 'remote-thread' };
const legacyPreview = vi.fn((props: RemoteFilePreviewProps) => <ChatRemoteFilePreview {...props} context={context} />);
let root: Root;
let host: HTMLDivElement;
let context: FilePreviewContext;
let environment: FileEnvironment;

function Entries() {
  const details = useContext(DetailsContext)!;
  return <>
    <button onClick={() => { void details.openFile(target); }}>Default</button>
    <button onClick={() => { void details.openFile(target, { browser: false }); }}>Legacy file</button>
    <button onClick={() => { void details.openRemoteFile?.(target); }}>Legacy remote</button>
  </>;
}

const render = (remote: boolean) => act(async () => root.render(
  <BrowserClientContext.Provider value={{ native: false, request: async () => ({ tabs: [] }),
    subscribe: async () => () => {} }}>
  <FileEnvironmentContext.Provider value={remote ? environment : null}>
    <DetailsWorkspace selected="remote-thread" active renderRemoteFile={legacyPreview}>
      <Entries />
    </DetailsWorkspace>
  </FileEnvironmentContext.Provider></BrowserClientContext.Provider>,
));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900));
  vi.stubGlobal('open', vi.fn());
  URL.createObjectURL = vi.fn(() => 'blob:pdf-preview');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(filePreviewApi, 'open').mockResolvedValue({ ...target, sessionId: 'pdf-session',
    name: 'report.PDF', kind: 'pdf', text: null, url: 'http://preview.test/report.PDF' });
  vi.spyOn(filePreviewApi, 'close').mockResolvedValue();
  environment = { remote: true, previews: filePreviewApi,
    actions: { applications: vi.fn(async () => []), perform: vi.fn() },
    resolveWebsite: vi.fn(), image: () => null };
  context = { ...target, ready: true,
    load: vi.fn(async () => ({ path: target.path, text: 'Wrong text preview' })), client: {
    open: vi.fn(async () => ({ id: '12345678-1234-1234-1234-123456789012', size: 4,
      name: 'report.PDF', mimeType: 'application/pdf' })),
    read: vi.fn(async () => ({ offset: 0, data: 'JVBERg==' })), close: vi.fn(async () => {}),
  } };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each([false, true])('opens default and legacy PDF entries in the built-in browser (remote=%s)', async remote => {
  await render(remote);
  for (const name of ['Default', 'Legacy file']) {
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === name)!.click());
    const browser = host.querySelector('.website-preview-browser');
    expect(browser, name).not.toBeNull();
    expect(browser?.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('report.PDF');
    expect(browser?.querySelector('[data-pdf-preview]')?.getAttribute('data-pdf-preview'))
      .toBe('http://preview.test/report.PDF');
  }
  expect(host.querySelectorAll('.pm-browser-tab')).toHaveLength(1);
  expect(legacyPreview).not.toHaveBeenCalled();
  expect(environment.actions.perform).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
});

it('keeps a legacy remote PDF in the connected computer browser without calling the local preview API', async () => {
  await render(true);
  await act(async () => [...host.querySelectorAll('button')]
    .find(button => button.textContent === 'Legacy remote')!.click());
  expect(document.querySelector('.pm-browser [role="tab"][aria-selected="true"]')?.textContent).toContain('report.PDF');
  expect(document.querySelector('[data-pdf-preview]')).not.toBeNull();
  expect(context.client.open).toHaveBeenCalledWith(target.threadId, target.path, { preview: 'pdf' });
  expect(context.load).not.toHaveBeenCalled();
  expect(filePreviewApi.open).not.toHaveBeenCalled();
});

it.each(['content', 'sheet'])('never reads a PDF as text in the legacy %s component', async entry => {
  await act(async () => root.render(entry === 'content'
    ? <ChatFilePreviewContent path={target.path} context={context} />
    : <ChatFilePreview path={target.path} context={context} onClose={vi.fn()} />));
  expect(document.querySelector('[data-pdf-preview]')).not.toBeNull();
  expect(document.querySelector('.pm-browser [role="tab"][aria-selected="true"]')?.textContent).toContain('report.PDF');
  expect(context.client.open).toHaveBeenCalledWith(target.threadId, target.path, { preview: 'pdf' });
  expect(context.client.close).toHaveBeenCalled();
  expect(context.load).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf-preview');
});

it('keeps a failed binary PDF read out of the text reader', async () => {
  vi.mocked(context.client.open).mockRejectedValue(new Error('Disconnected'));
  await act(async () => root.render(<ChatFilePreviewContent path={target.path} context={context} />));
  expect(document.querySelector('.pm-browser')?.textContent).toContain('暂时无法预览此文件');
  expect(context.load).not.toHaveBeenCalled();
});
