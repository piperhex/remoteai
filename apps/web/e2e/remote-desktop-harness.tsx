import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ChatTools } from '../src/chat/ChatTools';
import { GuiToolbox } from '../../desktop/src/pages/codexGui/GuiToolbox';
import { GuiRemoteDesktop } from '../../desktop/src/pages/codexGui/GuiRemoteDesktop';
import { client } from './remote-desktop-fixture';
import '../src/styles.css';
import '../src/chat/chat.css';
import '../../desktop/src/pages/codexGui/remote/remoteGui.less';

// Let a desktop browser inspect the mobile controls without changing production pointer detection.
if (new URLSearchParams(location.search).has('touch')) {
  const matchMedia = window.matchMedia.bind(window);
  window.matchMedia = query => {
    const media = matchMedia(query);
    if (query === '(any-pointer: fine)') Object.defineProperty(media, 'matches', { value: false });
    return media;
  };
}

function Harness() {
  const [connected, setConnected] = useState(true);
  return <main style={{ padding: 24 }}><h1>电脑工具</h1>
    <button id="disconnect-chat" onClick={() => setConnected(false)}>模拟聊天连接中断</button>
    {new URLSearchParams(location.search).has('native-clipboard')
      ? <section className="gui-remote-workspace chat-page" style={{ display: 'block', height: 'auto' }}>
        <header className="chat-header">
          <div className="chat-grow"><h2>远程对话</h2>
            <GuiRemoteDesktop client={client.desktop} active connected={connected} />
            <div className="chat-connection-info">Windows · Relay</div>
          </div>
          <GuiToolbox git={client.git} cwd="C:/workspace" active
            connected={connected} deviceName="Windows 测试电脑" />
        </header>
      </section>
      : <ChatTools client={client} cwd="C:/workspace" active connected={connected} deviceName="Windows 测试电脑" />}
    <input aria-label="本机聊天消息" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
