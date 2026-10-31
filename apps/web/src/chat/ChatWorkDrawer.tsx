import { t, useLanguage } from '../i18n';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { WorkEntry } from '../../../../shared/chat/turnPresentation';
import { toolText } from '../../../../shared/chat/toolText';
import { ChatActivity } from './ChatActivity';
import { ChatMessage } from './ChatMessage';
import { ChatToolContent } from './ChatToolContent';
import { ChatQuoteButton } from './ChatQuotes';
import './workDrawer.css';

export function ChatWorkDrawer({ entry, onClose }: {
  entry: Pick<WorkEntry, 'turn' | 'items'>; onClose: () => void;
}) {
  useLanguage();
  const running = entry.turn.status === 'inProgress';
  return <AdaptiveSheet open mobileFullscreen className="chat-work-drawer"
    title={running ? t('client.chat.working') : t('client.chat.activity')}
    subtitle={t('client.chat.actions', { value1: entry.items.length })} width={760} onClose={onClose}>
    <div className="chat-detail-stack">{entry.items.map(item =>
      ['userMessage', 'agentMessage'].includes(item.type)
        ? <ChatMessage key={item.id} item={item} process onOpen={onClose} onQuote={onClose}
          running={running && item.status !== 'completed'} />
        : <ChatActivity key={item.id} item={item} inline onOpen={onClose}
          running={running && item.status === 'inProgress'} content={() => <>
            <ChatToolContent item={item} />
            <ChatQuoteButton messageId={item.id} role="tool" text={toolText(item)} onQuote={onClose} />
          </>} />)}</div>
  </AdaptiveSheet>;
}
