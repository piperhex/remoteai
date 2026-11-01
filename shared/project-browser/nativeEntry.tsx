import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectBrowser, type ProjectBrowserHandle } from './ProjectBrowser';
import type { BrowserHostMessage, BrowserSettings } from './nativeBridge';
import type { ProjectBrowserClient } from './protocol';
import { autoSaveDelay } from './preferences';
import type { BrowserHost } from './entryActions';
import { setInterfaceLanguage } from '../localization/interfaceLanguage';
import { displayText } from '../localization/messages';
import { nativeSshTreeOptions } from '../terminal/nativeSshBrowser';
import { TerminalWorkspaceProvider } from '../terminal/TerminalWorkspaceProvider';
import { nativeScriptPanel } from './nativeScripts';
import { readProjectDocument } from './fileTransfer';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
    projectBrowserMessage: (message: BrowserHostMessage) => void;
  }
}

const REQUEST_TIMEOUT = 60_000;
const DOWNLOAD_TIMEOUT = 30 * 60_000;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>; action: string; finished: Promise<void>; finish: () => void }>();
let nextId = 0;
const send = (message: unknown) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));
const request = <T,>(action: string, body: object) => new Promise<T>((resolve, reject) => {
  const id = ++nextId;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const timer = setTimeout(() => {
    pending.delete(id); reject(new Error('请求超时，请重试。')); finish();
  }, action === 'download' ? DOWNLOAD_TIMEOUT : REQUEST_TIMEOUT);
  pending.set(id, { resolve: value => resolve(value as T), reject, timer, action, finished, finish });
  send({ type: 'request', id, action, body });
});
const client: ProjectBrowserClient = {
  list: (_cwd, directory, query) => request('list', { directory, query }),
  read: (target, signal) => readProjectDocument(<T,>(input: object) => {
    const body = input as import('./protocol').ProjectFileRead;
    return request<T>(body.window?.cancel ? 'release' : 'read', body);
  }, target, signal, false),
  release: target => request('release', target),
  save: target => request('save', target),
  mutate: target => request('mutate', target),
};
const blameClient: ProjectBrowserClient = { ...client, blame: target => request('blame', target) };
const host: BrowserHost = {
  copyPath: path => request('copyPath', { path }),
  download: target => request('download', target),
  reference: async entry => { await request('reference', entry); await close(); },
  quoteSelection: async selection => { await request('quoteSelection', selection); await close(); },
};
const element = document.getElementById('root');
if (!element) throw new Error('Missing browser root');
const root = createRoot(element);
const browser = createRef<ProjectBrowserHandle>();
let closing = false;
let currentSettings: BrowserSettings | undefined;
async function close() {
  if (closing) return;
  closing = true;
  if (currentSettings) render(currentSettings);
  // Finish writes before disposing the WebView so its saved revisions remain accurate on reopen.
  await Promise.all([...pending.values()].filter(task => ['save', 'mutate'].includes(task.action))
    .map(task => task.finished));
  send({ type: 'closed', snapshot: browser.current?.snapshot() });
}
function render(settings: BrowserSettings) {
  currentSettings = settings;
  if (settings.language) setInterfaceLanguage(settings.language);
  if (settings.themeMode) {
    document.documentElement.dataset.theme = settings.themeMode;
    document.documentElement.style.colorScheme = settings.themeMode;
  }
  for (const [name, value] of Object.entries(settings.theme)) {
    if (/^--[\w-]+$/.test(name)) document.documentElement.style.setProperty(name, value);
  }
  const capabilities = settings.capabilities;
  const actionsHost = capabilities ? { ...host, ...capabilities,
    reference: capabilities.reference ? host.reference : undefined,
    quoteSelection: capabilities.quoteSelection ? host.quoteSelection : undefined } : host;
  root.render(<TerminalWorkspaceProvider panel={nativeScriptPanel(settings.scripts, send)}>
    <ProjectBrowser key={settings.cwd} ref={browser}
      client={capabilities?.blame ? blameClient : client} cwd={settings.cwd} host={actionsHost}
      treeOptions={nativeSshTreeOptions({ ...settings, connected: settings.connected && !closing }, send)}
      connected={settings.connected && !closing} t={text => settings.labels[text] ?? displayText(text)}
      initialSnapshot={settings.snapshot} runScripts={!!settings.scripts}
      onFullscreenChange={active => send({ type: 'fullscreen', active })}
      onSnapshot={snapshot => send({ type: 'snapshot', cwd: settings.cwd, snapshot })}
      preferences={{ delay: autoSaveDelay(settings.autoSaveDelay),
        change: delay => { send({ type: 'preferences', delay }); render({ ...settings, autoSaveDelay: delay }); } }}
      onClose={() => { void close(); }} />
  </TerminalWorkspaceProvider>);
}
window.projectBrowserMessage = message => {
  if (message.type === 'settings') { render(message); return; }
  if (message.type === 'close') { browser.current?.requestClose(); return; }
  const task = pending.get(message.id);
  if (!task) return;
  clearTimeout(task.timer); pending.delete(message.id);
  if (message.error) task.reject(new Error(message.error)); else task.resolve(message.data);
  task.finish();
};
send({ type: 'ready' });
