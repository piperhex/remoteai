import * as React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { HtmlPreviewDocument } from './HtmlPreviewDocument';
import type { PreparedHtml } from './HtmlPreparation';

const state = vi.hoisted(() => ({ prepared: undefined as PreparedHtml | undefined, loading: true }));
vi.mock('react', async original => ({ ...await original<typeof React>(),
  useEffect: () => {}, useMemo: (create: () => unknown) => create(),
  useState: (initial: unknown) => initial === true
    ? [state.loading, (value: boolean) => { state.loading = value; }]
    : [state.prepared, (value: PreparedHtml) => { state.prepared = value; }],
}));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', ActivityIndicator: 'Spinner', Platform: { OS: 'android' } }));
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }));
vi.mock('../../theme/store', () => ({ useThemeColor: () => (color: string) => color }));
vi.mock('./HtmlPreparation', () => ({ HtmlPreparation: 'Prepare' }));
const context = { path: 'F:/report/index.html', threadId: 'thread',
  client: { open: vi.fn(), read: vi.fn(), close: vi.fn() } };
const html = '<img src="relative.png"><script>document.title="Preview"</script>';
type Props = { children?: React.ReactNode; source?: { html: string }; onLoadEnd: () => void;
  onShouldStartLoadWithRequest: (request: { url: string }) => boolean; [key: string]: unknown };
function nodes(value: unknown): React.ReactElement<Props>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Props>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
const render = () => nodes(HtmlPreviewDocument({ text: html, context, onError: vi.fn() }));
beforeEach(() => { vi.stubGlobal('React', React); state.prepared = undefined; state.loading = true; });

it('shows a loading icon until dependencies and the rendered WebView are ready', () => {
  expect(render().some(node => node.type === 'Spinner')).toBe(true);
  expect(render().some(node => node.type === 'Prepare')).toBe(true);
  expect(render().some(node => node.type === 'WebView')).toBe(false);
  state.prepared = { html: '<img src="data:image/png;base64,AAAA">', failed: false };
  expect(render().some(node => node.type === 'Prepare')).toBe(false);
  const view = render().find(node => node.type === 'WebView')!;
  expect(view.props.source?.html).toBe(state.prepared.html);
  expect(render().some(node => node.type === 'Spinner')).toBe(true);
  view.props.onLoadEnd();
  expect(render().some(node => node.type === 'Spinner')).toBe(false);
});

it('never gives the rendered page a native bridge, files, cookies, permissions or external navigation', () => {
  state.prepared = { html, failed: false };
  const props = render().find(node => node.type === 'WebView')!.props;
  expect(props).toMatchObject({ incognito: true, allowFileAccess: false,
    allowFileAccessFromFileURLs: false, allowUniversalAccessFromFileURLs: false,
    sharedCookiesEnabled: false, thirdPartyCookiesEnabled: false, originWhitelist: ['*'],
    javaScriptCanOpenWindowsAutomatically: false, setSupportMultipleWindows: false,
    geolocationEnabled: false, mediaCapturePermissionGrantType: 'deny' });
  expect(props.onMessage).toBeUndefined();
  for (const url of ['about:blank', 'about:blank#section']) {
    expect(props.onShouldStartLoadWithRequest({ url })).toBe(true);
  }
  for (const url of ['https://example.com', 'file:///private/data', 'intent://app', 'javascript:alert(1)']) {
    expect(props.onShouldStartLoadWithRequest({ url })).toBe(false);
  }
});
