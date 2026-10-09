import { t, useLanguage } from '../i18n';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { ChatTurnFiles } from './ChatTurnFiles';
import type { Turn } from './types';
import { completedTurnFiles } from '../../../../shared/chat/turnPresentation';
import { generatedImageSource } from '../../../../shared/chat/imageSources';
import { ChatImage } from './ChatImage';
import { useTaskReviewAvailable } from '../../../../shared/remote-chat/TaskReviewContext';
import { ChatRetryButton } from './ChatRetryButton';

export type TurnPanel = 'plan' | 'changes' | 'error' | 'result';
export function turnErrorNotice(turn: Turn) {
  if (turn.status === 'failed' || turn.error) return t("本次回复遇到问题，已中断。");
  if (turn.status === 'completed') return t("本次回复曾出现连接中断，现已恢复。");
  if (turn.status === 'interrupted') return t("本次回复曾出现连接中断。");
  return t("连接暂时中断，Codex 正在重试…");
}

export function ChatTurnSummary({ turn, onOpen, hideStopped = false }: {
  turn: Turn; onOpen: (panel: TurnPanel) => void; hideStopped?: boolean;
}) {
  useLanguage();
  const reviewAvailable = useTaskReviewAvailable(turn.status);
  const files = useMemo(() => completedTurnFiles(turn), [turn]);
  const generated = [...new Set(turn.items.filter(item => item.type === 'imageGeneration'
    && item.status === 'completed' && !item.failure).map(generatedImageSource).filter(Boolean))];
  const running = turn.status === 'inProgress';
  return <section className="chat-turn-summary">
    {generated.map(source => <ChatImage key={source} source={source} description={t("生成的图片")} />)}
    {!!turn.plan?.length && <button type="button" className="chat-plan-summary" aria-label={t("查看任务计划")}
      onClick={() => onOpen('plan')}><strong>{t("任务计划")}</strong>
      <span>{turn.plan.filter(step => step.status === 'completed').length}/{turn.plan.length}</span>
      <ChevronRight size={15} /></button>}
    {!!files.length && <ChatTurnFiles files={files} running={running} onOpen={() => onOpen('changes')}
      onResult={reviewAvailable ? () => onOpen('result') : undefined} />}
    {turn.status === 'interrupted' && !hideStopped && <p className="chat-muted">{t("已停止生成")}</p>}
    {(turn.error || turn.retryError || turn.status === 'failed') && <div className="chat-turn-error"><button type="button"
      className="chat-error-notice" aria-label={t("查看报错详情")} onClick={() => onOpen('error')}>
      {turnErrorNotice(turn)} <u>{t("查看报错详情")}</u></button>
      <ChatRetryButton turnId={turn.id} /></div>}
  </section>;
}
