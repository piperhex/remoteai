import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, Input, theme } from 'antd';
import { ProjectPicker } from '../src/pages/codexGui/ProjectPicker';
import { Messages } from '../src/pages/codexGui/Messages';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { previewConversation } from './compact-project-conversation';
import { capacityConversation, singleCapacityConversation } from './compact-project-capacity';
import { gitApi } from '../../../shared/conversation/gitApi';
import { TurnRetryProvider } from '../../../shared/chat/TurnRetryContext';
import styles from '../../../shared/conversation/styles.module.less';
import 'antd/dist/reset.css';
import '../src/styles.css';

const params = new URLSearchParams(location.search);
const dark = params.has('dark');
const fullConversation = params.get('view') === 'full';
const singleCapacity = params.get('view') === 'single';
const capacityValue = singleCapacity ? singleCapacityConversation : capacityConversation;
function previewUrl(full: boolean, darkMode: boolean, single = false) {
  const query = new URLSearchParams();
  if (full) query.set('view', 'full');
  else if (single) query.set('view', 'single');
  if (darkMode) query.set('dark', '');
  return `?${query}`;
}
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
// Exercise the GUI's container layout without the desktop shell's 820px minimum window width.
document.body.style.minWidth = '0';
// The visual fixture must not read or undo changes in a real workspace.
gitApi.undo = async (request) => ({ undone: !request.checkOnly });
function Harness() {
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [retries, setRetries] = useState(0);
  const target = useRef<HTMLDivElement>(null);
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: { motion: false } }}><App>
    <div className={`${styles.page} ${styles.collapsed}`} style={{ height: '100vh' }}>
      <div className={styles.workspace}>
        <DetailsWorkspace selected="thread" active contentClassName={styles.workspace}>
        <TurnRetryProvider target={{ threadId: 'thread', turnId: 'failed' }} disabled={false}
          onRetry={async () => { setRetries(count => count + 1); return false; }}>
          <Messages selected="thread" value={fullConversation ? previewConversation : capacityValue}
            footer={<div ref={target}
            className={styles.composerWrap} data-testid="project-drop-target">
            <ProjectPicker value={path} projects={[]} disabled={false} gitEnabled dropTarget={target}
              onChange={setPath} onError={cause => setError(String(cause))} />
            <div className={styles.composer}>
              <Input.TextArea aria-label="消息草稿" placeholder="输入内容，体验消息输入区域…" rows={2} />
              <div className={styles.composerHint}>
                <span>{fullConversation ? '6 轮示例对话' : '容量提示间距预览'}</span>
                <a href={previewUrl(false, dark, !singleCapacity)}>
                  {singleCapacity ? '查看多条提示' : '查看单条提示'}</a>
                <a href={previewUrl(!fullConversation, dark)}>
                  {fullConversation ? '查看容量提示' : '查看完整对话'}</a>
                <a href={previewUrl(fullConversation, !dark, singleCapacity)}>{dark ? '浅色外观' : '深色外观'}</a>
              </div>
            </div>
            <output aria-label="项目路径" hidden>{path}</output>
            <output aria-label="重试次数" hidden>{retries}</output>
            {error && <p role="alert">{error}</p>}
          </div>} />
        </TurnRetryProvider>
        </DetailsWorkspace>
      </div>
    </div>
  </App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
