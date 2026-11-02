import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useContext } from 'react';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ChatFileContext, ChatFileProvider } from '../src/chat/ChatFilePreview';
import { textMetrics } from '../src/theme/text';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { updateThemeMode } from '../src/theme/store';
import { Buffer } from 'buffer';
import { fromByteArray } from 'base64-js';
import { HTML_FIXTURE_ASSETS, HTML_FIXTURE_DOCUMENT, HTML_FIXTURE_PATH } from '../../../shared/file-preview/htmlPreviewFixture';
import { statusBarTestImage } from './modalStatusBarImage';

setInterfaceLanguage('zh');
updateThemeMode('dark');

const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<style>body{margin:0;background:#101719;color:#e6eeee;font:18px sans-serif}header{padding:24px;'
  + 'border-bottom:1px solid #52645b}main{height:100vh;display:grid;place-items:center}button{padding:16px}</style>'
  + '</head><body><header>在线交流 · 文件预览</header><main><button onclick="this.textContent=\'已点击\'">'
  + '保留预览状态</button></main><footer>预览底部</footer></body></html>';
const samples: Record<string, string> = {
  '页面预览.html': html,
  '说明文档.md': '# 文件预览\n\n' + '中文内容可以完整阅读，长文档支持滚动。\n\n'.repeat(40) + '文档底部',
  '代码预览.ts': 'const ready = true;\n'.repeat(100),
  '安装包.apk': '',
  '相对资源.html': HTML_FIXTURE_DOCUMENT,
  '缺失资源.html': HTML_FIXTURE_DOCUMENT.replaceAll('images/preview%20image.svg', 'missing.png'),
  'PNG 资源.html': HTML_FIXTURE_DOCUMENT.replaceAll('images/preview%20image.svg', 'images/original.png'),
};
const opened = new Map<string, { bytes: Uint8Array; mime: string }>();
const client = {
  open: async (_threadId: string, path: string) => {
    const fixture = HTML_FIXTURE_ASSETS[path.replace('F:/preview test/页面/', '')];
    const asset = path.endsWith('/images/original.png')
      ? { bytes: Buffer.from(statusBarTestImage.split(',')[1], 'base64'), mime: 'image/png' }
      : fixture && { bytes: Buffer.from(fixture.text), mime: fixture.mime };
    if (!asset) throw new Error('Fixture asset unavailable');
    const id = `11111111-1111-4111-8111-${String(opened.size).padStart(12, '0')}`;
    opened.set(id, asset);
    return { id, size: asset.bytes.length, name: path.split('/').at(-1)!, mimeType: asset.mime };
  },
  read: async ({ id, offset, length }: { id: string; offset: number; length: number }) => {
    const asset = opened.get(id)!;
    if (asset.mime.startsWith('image/')) await new Promise(resolve => setTimeout(resolve, 6000));
    return { offset, data: fromByteArray(asset.bytes.subarray(offset, offset + length)) };
  },
  close: async (_threadId: string, id: string) => { opened.delete(id); },
};
const load = async (_threadId: string, path: string) => ({
  path: /资源\.html$/.test(path) ? HTML_FIXTURE_PATH : path, text: samples[path.split(/[\\/]/).at(-1)!],
});
const videos = { ...client, open: async () => { throw new Error('Fixture does not preview videos'); } };

function Links() {
  const open = useContext(ChatFileContext);
  return <>{Object.keys(samples).map(name => <Pressable key={name} accessibilityRole="button"
    accessibilityLabel={name} onPress={() => open?.({ path: `C:/测试/附件/${name}` })} style={{ padding: 20 }}>
    <Text style={{ ...textMetrics(18, 28), color: '#ffffff' }}>{name}</Text>
  </Pressable>)}</>;
}

function FilePreviewFixture() {
  const [fontsReady] = useFonts(MaterialCommunityIcons.font);
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#101719' }}>
    {fontsReady && <ChatFileProvider threadId="preview-fixture" ready files={client} videos={videos} load={load}>
      <Links />
    </ChatFileProvider>}
  </SafeAreaView></SafeAreaProvider>;
}

registerRootComponent(FilePreviewFixture);
