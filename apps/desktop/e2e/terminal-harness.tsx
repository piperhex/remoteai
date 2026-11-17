import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PanelBottom } from "lucide-react";
import TerminalPanel from "../../../shared/terminal/views/TerminalPanel";
import { useTerminalPanel } from "../../../shared/terminal/views/useTerminalPanel";
import { terminalApi, type TerminalEvent } from "../src/pages/codexGui/terminal/api";
import { DetailsWorkspace } from "../../../shared/conversation/DetailsWorkspace";
import { ConversationChangesButton } from "../../../shared/conversation/ConversationChangesButton";
import styles from "../../../shared/conversation/styles.module.less";
import type { TerminalApi } from '../../../shared/terminal/types';
import { ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { BrowserNavigationProvider } from '../../../shared/browser/BrowserNavigationProvider';
import { BrowserPage } from '../../../shared/browser/BrowserPage';
import { setGuiLanguage } from '../../../shared/localization/uiText';

const params = new URLSearchParams(location.search);
setGuiLanguage('zh');
localStorage.setItem('codex-switch:global-font-size', params.get('font') ?? '14');

const sessions = new Map<string, (event: TerminalEvent) => void>();
const writes: string[] = [];
const sizes: { cols: number; rows: number }[] = [];
let opens = 0;
let closes = 0;
let ticks = 0;
const links: string[] = [];
const external: string[] = [];
window.open = url => { external.push(String(url)); return null; };
const output = (id: string, text: string) => sessions.get(id)?.({ type: "output", data: [...new TextEncoder().encode(text)] });
terminalApi.open = async (cwd, _size, receive) => {
  const id = String(++opens); sessions.set(id, receive);
  setTimeout(() => output(id, `Windows PowerShell\r\nPS ${cwd}> `), 30);
  return { id, cwd, shell: "PowerShell" };
};
terminalApi.write = async (id, data) => { writes.push(data); output(id, data); };
terminalApi.resize = async (_id, size) => { sizes.push(size); };
terminalApi.close = async (id) => { sessions.delete(id); closes++; };
const fixtureApi: TerminalApi = { ...terminalApi };
if (new URLSearchParams(location.search).has('remote')) {
  fixtureApi.resolveLink = async (id, url) => {
    links.push(`${id}:${url}`);
    return `${location.origin}/e2e/terminal-site.html`;
  };
}
setInterval(() => { ticks++; }, 20);
Object.assign(window, { terminalHarness: { snapshot: () => ({ opens, closes, writes, sizes, ticks, links, external }),
  output: (text: string) => { for (const id of sessions.keys()) output(id, text); },
  stream: () => { for (const id of sessions.keys()) output(id, "\r\n持续输出 中文 😀\r\n"); } } });

function Fixture() {
  const panel = useTerminalPanel("D:\\projects\\example");
  const [dark, setDark] = useState(params.has('dark'));
  const [browserVisible, setBrowserVisible] = useState(false);
  const toggleTheme = () => { document.documentElement.dataset.theme = dark ? "light" : "dark"; setDark(!dark); };
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: [
    dark ? theme.darkAlgorithm : theme.defaultAlgorithm, theme.compactAlgorithm,
  ] }}><BrowserNavigationProvider onOpen={() => setBrowserVisible(true)}>
    <div style={{ height: "100vh", background: dark ? "#151515" : "#faf8f4", color: dark ? "#eee" : "#222",
    fontFamily: "sans-serif", '--panel': dark ? '#151515' : '#faf8f4', '--ink': dark ? '#eee' : '#222',
    '--line': dark ? '#333' : '#ddd', '--muted': '#888' } as React.CSSProperties}>
    <div hidden={browserVisible} style={{ height: '100%' }}>
    <DetailsWorkspace selected="test" active={!browserVisible}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <header className={styles.header}>
          <div className={styles.heading}><strong>分析表格搜索行为差异</strong></div>
          <div className={styles.headerActions}>
            <button onClick={toggleTheme}>切换主题</button>
            <button aria-label="切换终端" aria-expanded={panel.open} onClick={panel.toggle}><PanelBottom size={16} /></button>
            <ConversationChangesButton />
          </div>
        </header>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 20 }}>
          <p>聊天内容</p><textarea aria-label="聊天输入" placeholder="随心输入" style={{ marginTop: 'auto', minHeight: 80 }} />
        </div>
        {panel.tabs.length > 0 && <TerminalPanel panel={panel} api={fixtureApi} active />}
      </div>
    </DetailsWorkspace>
    </div>
    {browserVisible && <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <button onClick={() => setBrowserVisible(false)}>返回会话</button>
      <BrowserPage language="zh" onClose={() => setBrowserVisible(false)} /></div>}
  </div></BrowserNavigationProvider></ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
