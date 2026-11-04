import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { ChatUsage } from '../../../shared/remote-chat/views/ChatUsage';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import type { Language } from '../../../shared/localization/language';
import { QuotaComposerFixture, readQuota } from './quota-composer-fixture';
import '../src/pages/codexGui/remote/remoteGui.less';
import '../../../shared/remote-chat/views/composerDesktop.css';

setInterfaceLanguage('zh');
function Harness() {
  const [open, setOpen] = useState(true);
  const [language, setLanguage] = useState<Language>('zh');
  return <ConfigProvider><main>
    <button onClick={() => setOpen(value => !value)}>{open ? 'Close' : 'Open'}</button>
    <select aria-label="Language" value={language} onChange={event => {
      const next = event.target.value as Language;
      setInterfaceLanguage(next); setLanguage(next);
    }}>{['zh', 'en', 'ru', 'ja'].map(value => <option key={value}>{value}</option>)}</select>
    {open && <>
      <section data-testid="local"><h2>PC local</h2><QuotaComposerFixture local /></section>
      <section data-testid="remote" className="gui-remote-workspace chat-page">
        <h2>PC remote</h2><div className="chat-conversation"><QuotaComposerFixture /></div>
      </section>
      <section data-testid="web"><h2>Web PC</h2>
        <div className="chat-conversation"><QuotaComposerFixture web /></div></section>
      <section data-testid="settings"><h2>Mobile settings</h2><ChatUsage read={readQuota} active ready
        quotaProgress /></section>
    </>}
  </main></ConfigProvider>;
}
const style = document.createElement('style');
style.textContent = '*{box-sizing:border-box}body{font-family:sans-serif;margin:20px;background:#f5f6f5}'
  + 'main{max-width:1100px;margin:auto}section{background:white;padding:12px;margin:18px 0;border-radius:12px}'
  + 'h2{font-size:16px}section.gui-remote-workspace.chat-page{display:block;height:auto}'
  + '.chat-conversation{display:block}.chat-composer-dock{margin:auto}'
  + '.quota-account{width:236px;max-width:100%;margin-bottom:12px}'
  + ':root{--ink:#233329;--panel:#fff;--line:#dfe6e1;--muted:#66796d;--green:#0b8065;'
  + '--gui-muted:#66796d;--chat-muted:#66796d;--gui-composer-surface:#f5f6f5;--gui-font-size:14px}';
document.head.append(style);
createRoot(document.getElementById('root')!).render(<Harness />);
