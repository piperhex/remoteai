import { RotateCcw } from 'lucide-react';
import { useTurnRetry } from '../../../../../shared/chat/TurnRetryContext';
import { guiText } from '../../i18n/guiText';
import styles from './RequestErrorNotice.module.less';

export function TurnRetryButton({ turnId }: { turnId: string }) {
  const action = useTurnRetry(turnId);
  if (!action) return null;
  return <button type="button" className={styles.retryButton} disabled={action.disabled}
    onClick={() => { void action.retry(); }}>
    <RotateCcw size={14} aria-hidden="true" />{action.pending ? guiText('正在重试…') : guiText('重试')}
  </button>;
}
