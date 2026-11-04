import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { BrowserContents } from '../../../shared/provider-market/ProviderBrowser';
import { createBrowserTab } from '../../../shared/provider-market/browserState';
import { WebsiteBrowserSurface } from '../../../shared/file-preview/workspace/ManagedBrowserSurface';
import { MessageImage } from '../../../shared/conversation/MessageImage';
import { ChatImage } from '../../../shared/remote-chat/views/ChatImage';
import { FileEnvironmentContext, type FileEnvironment } from '../../../shared/conversation/fileEnvironment';
import { ImageAiContext } from '../../../shared/chat/ImageAiContext';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { useThemeMode } from '../src/hooks/useThemeMode';
import type { BrowserReply } from '../../../shared/browser/automation';
import '../src/styles.css';
import '../../../shared/file-preview/workspace/websitePreview.css';
import '../../../shared/remote-chat/views/messages.css';
import 'antd/dist/reset.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
setGuiLanguage('zh');
localStorage.setItem('codex-switch:theme-mode', dark ? 'dark' : 'light');
const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 760;
const context = canvas.getContext('2d')!;
context.fillStyle = '#164943'; context.fillRect(0, 0, 1200, 760);
context.fillStyle = '#e4f2e8'; context.fillRect(70, 80, 1060, 600);
context.fillStyle = '#47a386'; context.beginPath(); context.arc(600, 290, 95, 0, Math.PI * 2); context.fill();
context.fillStyle = '#164943'; context.font = '44px sans-serif'; context.textAlign = 'center';
context.fillText('Remote AI · Image preview', 600, 470);
const source = canvas.toDataURL();
const url = `${isTauri() ? 'http://127.0.0.1:1553' : location.origin}/preview-site/guide`;
const unavailable = async (): Promise<never> => { throw new Error('Unexpected file operation'); };
const environment: FileEnvironment = { remote: true, resolveWebsite: async url => url,
  actions: { applications: unavailable, perform: unavailable },
  previews: { open: unavailable, close: unavailable },
  image: props => <ChatImage source={props.src} description={props.alt} /> };

function Harness() {
  useThemeMode();
  const [tab, setTab] = useState({ ...createBrowserTab(), title: 'guide', url });
  const [expanded, setExpanded] = useState(false);
  const managed = async () => {
    const reply = await invoke<BrowserReply>('codex_gui_browser', {
      request: { threadId: 'image-layer', command: { action: 'open', url, requestId: crypto.randomUUID() } },
    });
    if (reply.tab) setTab({ ...createBrowserTab(), ...reply.tab, automationThread: 'image-layer' });
  };
  return <ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    ...(mode === 'web' ? [] : [theme.compactAlgorithm])] }}>
    <main style={{ height: '100vh', display: 'flex', color: dark ? '#eee' : '#243b32',
      background: dark ? '#18221e' : '#f4f7f5' }}>
      <section style={{ padding: 28, flex: 1 }}>
        <h2>图片预览</h2><p>点击图片查看，关闭后继续浏览网页。</p>
        <FileEnvironmentContext.Provider value={mode === 'remote' ? environment : null}>
          <ImageAiContext.Provider value={{ enabled: true, send: async () => true }}>
            {mode === 'web' ? <ChatImage source={source} description="预览示例" />
              : <MessageImage src={source} alt="预览示例" />}
          </ImageAiContext.Provider>
        </FileEnvironmentContext.Provider>
        {isTauri() && <button onClick={() => { void managed(); }}>Managed browser</button>}
      </section>
      <aside className="pm-browser website-preview-browser"
        style={{ width: expanded ? '75%' : '50%', position: 'relative' }}>
        <BrowserContents open tabs={[tab]} activeId={tab.id} language="zh" commands={{}}
          Surface={WebsiteBrowserSurface} embedded fullscreen={expanded} toggleFullscreen={() => setExpanded(!expanded)}
          onNavigate={(_, url) => setTab(current => ({ ...current, url }))} onSelect={() => {}}
          onCloseTab={() => {}} onNewTab={() => {}} onClose={() => {}} onAction={() => {}} onPopup={() => {}} />
      </aside>
    </main>
  </ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
