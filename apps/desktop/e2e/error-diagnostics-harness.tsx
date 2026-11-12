import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { LogDiagnosticsPage, type LogDiagnosticsTab } from '../src/pages/LogDiagnosticsPage';
import { translate } from '../src/i18n';
import { Messages } from '../src/pages/codexGui/Messages';
import { conversation } from '../../../shared/conversation/events';
import { CONTINUE_MESSAGE } from '../../../shared/conversation/continuation';
import { TurnRetryProvider } from '../../../shared/chat/TurnRetryContext';
import type { Turn } from '../../../shared/conversation/types';
import styles from '../../../shared/conversation/styles.module.less';
import logStyles from '../src/pages/LogDiagnosticsPage/index.module.less';
import 'antd/dist/reset.css';
import '../src/styles.css';

document.body.style.minWidth = '0';
const message = '请求失败：上游响应在完成前意外中断。' + '读取响应时连接已关闭，请检查网络或服务状态。'.repeat(8);
const turns: Turn[] = ['first', 'second', 'last'].map((id, index) => ({
  id, status: 'failed', durationMs: 46_000, error: { message },
  items: index === 0 ? [{ id: 'question', type: 'userMessage', content: [{ type: 'text', text: '帮我检查项目' }] }]
    : [{ id: `continue-${id}`, type: 'userMessage', content: [{ type: 'text', text: CONTINUE_MESSAGE }] }],
}));
const value = conversation({ id: 'errors', cwd: '', preview: '', updatedAt: 1, turns });

function Harness() {
  const [tab, setTab] = useState<LogDiagnosticsTab>('errorLogs');
  const [exporting, setExporting] = useState(false);
  const [exports, setExports] = useState(0);
  const exportLogs = () => {
    if (exporting) return;
    setExporting(true);
    setExports(count => count + 1);
    window.setTimeout(() => setExporting(false), 500);
  };
  if (new URLSearchParams(location.search).has('logs')) return <ConfigProvider
    theme={{ algorithm: theme.compactAlgorithm, token: { fontSize: 14 } }}>
    <main className={logStyles.main} style={{ height: '100vh', padding: 16 }}>
      <LogDiagnosticsPage activeTab={tab} onTabChange={setTab} language="zh"
        t={(key, values) => translate('zh', key, values)} onExportLogs={exportLogs} exportingLogs={exporting} />
      <output aria-label="导出次数">{exports}</output>
    </main>
  </ConfigProvider>;
  return <TurnRetryProvider target={{ threadId: 'errors', turnId: 'last' }} disabled={false}
    onRetry={async () => false}>
    <div className={`${styles.page} ${styles.collapsed}`} style={{ height: '100vh' }}>
      <div className={styles.workspace}><Messages selected="errors" value={value} /></div>
    </div>
  </TurnRetryProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
