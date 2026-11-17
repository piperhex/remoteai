import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { message } from 'antd';
import { uiText } from '../../../../shared/localization/uiText';
import { connectBrowserDownloads } from './browserDownloads';

export function useBrowserDownloads() {
  const [messages, contextHolder] = message.useMessage();
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void connectBrowserDownloads(notice => {
      if (notice === 'confirmed') { messages.destroy('browser-download'); return; }
      const content = notice === 'failed' ? uiText('client.downloads.browser.failed') : uiText(notice === 'confirmation'
        ? 'client.downloads.browser.confirmInManager' : 'client.downloads.browser.added');
      const style = { maxWidth: 400, margin: '0 auto' };
      void messages.open({ key: 'browser-download', type: notice === 'failed' ? 'error' : 'info', content, style });
    }).then(stop => { if (disposed) stop(); else cleanup = stop; })
      .catch(() => console.warn('Could not connect browser downloads.'));
    return () => { disposed = true; cleanup?.(); };
  }, [messages]);
  return contextHolder;
}
