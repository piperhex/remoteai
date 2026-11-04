import { createRoot } from 'react-dom/client';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { GlobalFontSettingsCard } from '../src/pages/settings/GlobalFontSettingsCard';
import { GlobalFontSettings } from '../../../shared/appearance/GlobalFontSettings';
import { GuiAppearanceSettings } from '../../../shared/conversation/GuiAppearanceSettings';
import { GuiChatSettingsButton } from '../../../shared/conversation/GuiChatSettingsButton';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { Messages } from '../src/pages/codexGui/Messages';
import { ChatMessages } from '../../../shared/remote-chat/views/ChatMessages';
import { conversation } from '../../../shared/conversation/events';
import type { Thread } from '../../../shared/conversation/types';
import { uiText, setGuiLanguage } from '../../../shared/localization/uiText';
import { setLanguage, useLanguage } from '../../../shared/localization/browserClient';
import { WebLocaleProvider } from '../../web/src/i18n/WebLocaleProvider';
import { Button } from 'antd';
import styles from '../../../shared/conversation/styles.module.less';
import 'antd/dist/reset.css';
import '../../web/src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import '../../../shared/remote-chat/views/composer.css';
import '../src/pages/codexGui/remote/remoteGui.less';
import './font-size-harness.css';

const mode = new URLSearchParams(location.search).get('mode') ?? 'local';
if (mode !== 'web') void import('../src/pages/SettingsPage/index.module.less');
const thread: Thread = { id: 'font-thread', cwd: '', preview: '', updatedAt: 1, turns: [{
  id: 'turn', status: 'completed', items: [
    { id: 'question', type: 'userMessage', text: '请检查页面的字号。' },
    { id: 'reply', type: 'agentMessage', text: '正文应清晰易读，字号调整后立即生效。\n\n`const fontSize = 18;`' },
  ],
}] };

function Harness() {
  useLanguage();
  return <ApplicationTypography><WebLocaleProvider><main className="font-harness">
    <header className="font-harness-global">
      {mode === 'web' ? <GlobalFontSettings t={uiText} /> : <GlobalFontSettingsCard />}
      <div className="font-harness-actions"><Button>常用控件</Button>
        <button onClick={() => { setGuiLanguage('en'); setLanguage('en'); }}>English</button>
        <button onClick={() => { setGuiLanguage('zh'); setLanguage('zh'); }}>中文</button>
        {mode !== 'local' && <GuiChatSettingsButton active />}</div>
    </header>
    <aside className="font-harness-settings"><GuiAppearanceSettings /></aside>
    <section className="font-harness-conversation" data-testid="conversation">
      {mode === 'local' ? <DetailsWorkspace selected={thread.id} active>
        <div className={`${styles.page} ${styles.collapsed}`}>
          <div className={styles.workspace}><Messages selected={thread.id} value={conversation(thread)} /></div>
        </div>
      </DetailsWorkspace> : <div className={`chat-page ${mode === 'remote' ? 'gui-remote-workspace' : ''}`}>
        <ChatDetailsWorkspace selected={thread.id} active enabled>
          <div className="chat-conversation"><ChatMessages thread={thread} desktop />
            <div className="chat-composer"><textarea aria-label="聊天消息" defaultValue="字号预览" /></div>
          </div>
        </ChatDetailsWorkspace>
      </div>}
    </section>
  </main></WebLocaleProvider></ApplicationTypography>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
