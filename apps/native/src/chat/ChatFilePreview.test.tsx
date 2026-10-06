import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseFileReference, type FileReference } from '../../../../shared/chat/fileReference';
import { ChatFileProvider } from './ChatFilePreview';
import { ChatImageFilePreview } from './ChatImageFilePreview';
import { ImageViewer } from './ImageViewer';
import { VideoViewer } from './video/VideoViewer';

const state = vi.hoisted(() => ({
  file: null as FileReference | null, provider: true, ready: true,
  original: undefined as string | undefined, imageError: false, load: vi.fn(),
  text: undefined as { path: string; text: string } | undefined,
}));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
  useState: (initial: unknown) => state.provider
    ? [state.file, (file: FileReference | null) => { state.file = file; }]
    : [initial === undefined ? state.text : initial, vi.fn()],
  useContext: () => ({ threadId: 'thread-with-image', ready: state.ready, offline: true, load: state.load }),

  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ ActivityIndicator: 'Spinner', Modal: 'Modal', Pressable: 'Button',
  Text: 'Text', View: 'View', Keyboard: { dismiss: vi.fn() }, StyleSheet: {
    create: <T,>(styles: T) => styles, absoluteFillObject: {},
  } }));
vi.mock('react-native-gesture-handler', () => ({ GestureDetector: 'Gesture', GestureHandlerRootView: 'View' }));
vi.mock('react-native-reanimated', () => ({ default: { Image: 'Image' } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'View', SafeAreaView: 'View' }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'Icon' }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'Sheet' }));
vi.mock('../components/SheetScrollView', () => ({ SheetScrollView: 'ScrollView' }));
vi.mock('./ChatCodeBlock', () => ({ ChatCodeBlock: 'Code' }));
vi.mock('./ChatMarkdownPreview', () => ({ ChatMarkdownPreview: 'MarkdownPreview' }));
vi.mock('./ChatHtmlPreview', () => ({ ChatHtmlPreview: 'Html', isHtmlPath: (path: string) => /\.html?$/i.test(path) }));
vi.mock('./ChatCodeHighlight', () => ({ fileLanguage: () => 'text' }));
vi.mock('./fileDownloadTarget', () => ({ nativeDownloadTarget: {} }));
vi.mock('../downloads/useManagedDownload', () => ({ useManagedDownload: () => ({
  label: '下载', busy: false, start: vi.fn(), cancel: vi.fn(),
}) }));
vi.mock('./video/VideoViewer', () => ({ VideoViewer: 'Video' }));
vi.mock('./useImageGestures', () => ({ useImageGestures: () => ({ gesture: {}, animatedStyle: {} }) }));
vi.mock('./useImageOrientation', () => ({ useImageOrientation: () => ({ displayed: 'portrait' }) }));
vi.mock('./useSaveImage', () => ({ useSaveImage: () => ({ saving: false, message: '', save: vi.fn() }) }));
vi.mock('../../../../shared/chat/useImageViewer', () => ({ useImageViewer: () => ({
  url: state.original, error: state.imageError, fail: vi.fn(), request: vi.fn(), loading: false, loadOriginal: state.load,
}) }));

const fileClient = { open: vi.fn(), read: vi.fn(), close: vi.fn() };
const providerProps = { threadId: 'thread-with-image', ready: true, load: vi.fn(),
  files: fileClient, videos: { open: vi.fn(), read: vi.fn(), close: vi.fn() }, children: 'Conversation' };
const original = 'data:image/png;base64,aW1hZ2U=';

afterEach(() => vi.unstubAllGlobals());

function openFile(href: string) {
  state.provider = true;
  const reference = parseFileReference(href);
  expect(reference).toBeDefined();
  const before = ChatFileProvider(providerProps);
  before.props.value(reference);
  const content = ChatFileProvider(providerProps).props.children[1];
  state.provider = false;
  return content.type(content.props) as React.ReactElement<{ path: string; close: () => void }>;
}

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.clearAllMocks();
  state.file = null; state.provider = true; state.ready = true;
  state.original = undefined; state.imageError = false;
  state.text = undefined;
  state.load.mockResolvedValue(original);
});

it.each([
  '/F:/projects/codex-switch/.codex-tmp/image-annotation-preview/mobile.png',
  'C:\\images\\photo.JPG', './preview.webp', '/tmp/picture.gif', '/tmp/photo.jpeg',
  'file:///F:/images/phone%20preview.png',
])('opens image file links directly in the scoped image viewer: %s', async href => {
  const preview = openFile(href);
  expect(preview.type).toBe(ChatImageFilePreview);
  const viewer = ChatImageFilePreview(preview.props);
  expect(viewer.type).toBe(ImageViewer);
  expect(viewer.props.thumbnail).toBeUndefined();
  await expect(viewer.props.load()).resolves.toBe(original);
  expect(state.load).toHaveBeenCalledWith('thread-with-image', parseFileReference(href)!.path, true);
  expect(fileClient.open).not.toHaveBeenCalled();
  expect(providerProps.load).not.toHaveBeenCalled();
  viewer.props.close();
  expect(state.file).toBeNull();
});

it('lets the image loader retrieve a cached original while offline', async () => {
  state.ready = false;
  const preview = openFile('./cached.png');
  await expect(ChatImageFilePreview(preview.props).props.load()).resolves.toBe(original);
  expect(state.load).toHaveBeenCalledWith('thread-with-image', './cached.png', true);
});

it('preserves video playback and ordinary file previews', () => {
  expect(openFile('./clip.mp4').type).toBe(VideoViewer);
  for (const path of ['./report.pdf', './archive.zip', './source.ts']) {
    expect(openFile(path).type).not.toBe(ChatImageFilePreview);
    expect(openFile(path).type).not.toBe(VideoViewer);
  }
});

function descendants(value: unknown): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(descendants);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...descendants(value.props.children)];
}

it('loads and displays code in an external deployment directory using its exact path', () => {
  const path = 'F:/codex-deploy/admin-web/source/apps/desktop/src/remoteChat/legacyLinkFailures.test.ts';
  state.text = { path, text: 'const ready = true;\n' };
  providerProps.load.mockResolvedValue(state.text);
  const preview = openFile(path);
  const component = preview.type as (props: typeof preview.props) => React.ReactElement;
  const sheet = component(preview.props);
  const effect = vi.mocked(React.useEffect).mock.calls.at(-1)![0];
  const cleanup = effect();
  expect(providerProps.load).toHaveBeenCalledWith(providerProps.threadId, path);
  expect(descendants(sheet).find(node => node.type === 'Code')?.props).toMatchObject({
    text: state.text.text, lineNumbers: true, copyLabel: '复制文件内容',
  });
  cleanup?.();
});

it.each(['./index.html', './INDEX.HTM'])('renders HTML files directly while retaining the download action: %s', path => {
  state.text = { path, text: '<html><body>Preview</body></html>' };
  const preview = openFile(path);
  const component = preview.type as (props: typeof preview.props) => React.ReactElement;
  const sheet = component(preview.props);
  const nodes = descendants(sheet);
  expect(nodes.find(node => node.type === 'Html')?.props.text).toBe(state.text.text);
  expect(nodes.some(node => node.type === 'Code')).toBe(false);
  expect((sheet.props as { actions: { label: string }[] }).actions[0].label).toBe('下载');
});

it.each(['./verification.md', 'C:/docs/README.MARKDOWN'])('opens Markdown with rendering and download: %s', path => {
  state.text = { path, text: '# 检查结果\n\n- 已完成\n' };
  const preview = openFile(`${path}#L3`);
  const component = preview.type as (props: typeof preview.props) => React.ReactElement;
  const sheet = component(preview.props);
  const nodes = descendants(sheet);
  expect(nodes.find(node => node.type === 'MarkdownPreview')?.props).toMatchObject({ text: state.text.text, line: 3 });
  expect(nodes.some(node => node.type === 'Code' || node.type === 'Html')).toBe(false);
  expect((sheet.props as { actions: { label: string }[] }).actions[0].label).toBe('下载');
});

it('offers original loading without starting it and allows an explicit save before it loads', () => {
  const props = { description: 'mobile.png', load: state.load, close: vi.fn() };
  const loading = descendants(ImageViewer(props));
  expect(loading.some(node => node.type === 'Image')).toBe(false);
  expect(loading.some(node => node.props.children === '正在加载原图…')).toBe(false);
  expect(loading.some(node => node.props.accessibilityLabel === '查看原图')).toBe(true);
  expect(loading.find(node => node.props.accessibilityLabel === '下载图片到相册')?.props.disabled).toBe(false);
  state.original = original;
  const loaded = descendants(ImageViewer(props));
  expect(loaded.find(node => node.type === 'Image')?.props.source).toEqual({ uri: original });
  const download = loaded.find(node => node.props.accessibilityLabel === '下载图片到相册');
  expect(download?.props.disabled).toBe(false);
});

it('shows a retry when an image file cannot be loaded', async () => {
  const preview = openFile('./missing.png');
  state.load.mockRejectedValue(new Error('missing'));
  const props = ChatImageFilePreview(preview.props).props;
  await expect(props.load()).rejects.toThrow('missing');
  state.imageError = true;
  const nodes = descendants(ImageViewer(props));
  expect(nodes.some(node => node.props.accessibilityLabel === '重新加载原图')).toBe(true);
  expect(nodes.find(node => node.props.accessibilityLabel === '下载图片到相册')?.props.disabled).toBe(false);
});
