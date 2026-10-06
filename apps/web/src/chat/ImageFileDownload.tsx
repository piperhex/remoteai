import { useContext, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { ChatImageContext } from './ChatImage';
import { downloadChatImage } from './downloadImage';
import { t } from '../i18n';

/** The file-preview header and the full-screen viewer export the same managed original. */
export function ImageFileDownload({ path }: { path: string }) {
  const context = useContext(ChatImageContext);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const save = async () => {
    if (pending.current || !context?.threadId) return;
    pending.current = true; setSaving(true); setMessage('');
    try {
      const url = await context.load(context.threadId, path, true);
      await (context.save ?? downloadChatImage)(url);
      setMessage(t('已开始保存，请在浏览器下载列表中确认。'));
    } catch { setMessage(t('图片暂时无法下载，请重试。')); }
    finally { pending.current = false; setSaving(false); }
  };
  return <div><button type="button" className="chat-button" disabled={saving || !context?.ready}
    onClick={() => { void save(); }}><Download size={15} />{t(saving ? '正在保存…' : '下载')}</button>
    {message && <p role="status" className="chat-muted" style={{ maxWidth: 400 }}>{message}</p>}</div>;
}
