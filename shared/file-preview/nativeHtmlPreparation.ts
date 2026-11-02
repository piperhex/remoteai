import { prepareHtmlPreview } from './htmlAssets';
import type { PreviewLoader } from './kinds';

type AssetReply = { id: number; base64?: string; mime?: string };
type PreparationWindow = Window & {
  ReactNativeWebView: { postMessage: (message: string) => void };
  prepareHtml: (input: { text: string; path: string }) => Promise<void>;
  htmlAsset: (reply: AssetReply) => void;
};
const host = window as unknown as PreparationWindow;
const pending = new Map<number, (reply: AssetReply) => void>();
let nextId = 0;
const send = (message: unknown) => host.ReactNativeWebView.postMessage(JSON.stringify(message));

const load: PreviewLoader = (path, { signal }) => new Promise((resolve, reject) => {
  const id = nextId++;
  const abort = () => { pending.delete(id); reject(new DOMException('Aborted', 'AbortError')); };
  signal.addEventListener('abort', abort, { once: true });
  pending.set(id, reply => {
    pending.delete(id); signal.removeEventListener('abort', abort);
    if (reply.base64 === undefined) { reject(new Error('Asset unavailable')); return; }
    resolve(new Blob([Uint8Array.from(atob(reply.base64), char => char.charCodeAt(0))], { type: reply.mime }));
  });
  if (signal.aborted) { abort(); return; }
  send({ type: 'asset', id, path });
});

host.htmlAsset = reply => pending.get(reply.id)?.(reply);
host.prepareHtml = async input => {
  try {
    // DOMParser keeps the supplied document inert. Its scripts never run in this privileged WebView.
    const result = await prepareHtmlPreview({ ...input, load, signal: new AbortController().signal });
    send({ type: 'prepared', html: result.html, failed: result.failed, imageLinks: result.imageLinks });
  } catch { send({ type: 'error' }); }
};
send({ type: 'ready' });
