import { useState } from 'react';
import { pendingAsyncQuestions } from '../../../../../shared/conversation/asyncQuestionState';
import { QuestionPager } from '../../../../../shared/conversation/questions/QuestionPager';
import type { Conversation, Item } from '../../../../../shared/conversation/types';
import { dictationClient } from './dictation/client';
import layout from '../../../../../shared/conversation/styles.module.less';

export interface AsyncQuestionsProps {
  value?: Conversation;
  disabled?: boolean;
  active?: boolean;
  onAnswer: (item: Item, answers: string[]) => Promise<boolean>;
}

export function AsyncQuestions({ value, ...props }: AsyncQuestionsProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const key = (item: Item) => JSON.stringify([value?.thread.id, item.id]);
  const items = pendingAsyncQuestions(value).filter(item => !dismissed.has(key(item)));
  if (!items.length) return null;
  return <div className={layout.questionWrap}>
    <QuestionPager key={value?.thread.id} items={items} {...props} dictation={dictationClient}
      onDismiss={item => setDismissed(previous => new Set(previous).add(key(item)))} />
  </div>;
}
