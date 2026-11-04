import { uiText } from "../../../../../shared/localization/uiText";
import { useRef, useState } from "react";
import { Button, Input, Radio } from "antd";
import { X } from "lucide-react";
import { pendingAsyncQuestions } from "../../../../../shared/conversation/asyncQuestionState";
import type { Conversation, Item } from "../../../../../shared/conversation/types";
import { submitQuestionOnEnter } from "./questionKeyboard";
import layout from "../../../../../shared/conversation/styles.module.less";
import styles from "./AsyncQuestions.module.less";

export interface AsyncQuestionsProps {
  value?: Conversation;
  disabled?: boolean;
  onAnswer: (item: Item, answers: string[]) => Promise<boolean>;
}

export function AsyncQuestions({ value, ...props }: AsyncQuestionsProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  return <div className={layout.questionWrap}>
    {pendingAsyncQuestions(value).map((item) => {
      const key = JSON.stringify([value?.thread.id, item.id]);
      if (dismissed.has(key)) return null;
      return <QuestionCard key={key} item={item} {...props}
        onClose={() => setDismissed((previous) => new Set(previous).add(key))} />;
    })}
  </div>;
}

interface QuestionCardProps extends Omit<AsyncQuestionsProps, "value"> {
  item: Item;
  onClose: () => void;
}

function QuestionCard({ item, disabled, onAnswer, onClose }: QuestionCardProps) {
  const questions = item.questions ?? [];
  const [answers, setAnswers] = useState(() => questions.map((question) => question.options?.[0] ?? ""));
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submitting = useRef(false);
  const canSubmit = !disabled && answers.every((answer) => answer.trim());
  const setAnswer = (index: number, answer: string) =>
    setAnswers((previous) => previous.map((value, position) => position === index ? answer : value));
  const submit = async () => {
    if (submitting.current || !canSubmit) return;
    submitting.current = true;
    setBusy(true);
    try { setSubmitted(await onAnswer(item, answers)); }
    finally { submitting.current = false; setBusy(false); }
  };
  if (submitted) return null;
  return <section className={styles.card} aria-label={uiText("client.chat.moreInformationNeeded")} aria-busy={busy}
    onKeyDown={(event) => submitQuestionOnEnter(event, submit)}>
    <div className={styles.header}>
      <strong>{uiText("client.chat.moreInformationNeeded")}</strong>
      <Button type="text" size="small" aria-label={uiText("client.composer.closeAdditionalInformation")} icon={<X size={16} />}
        onClick={onClose} onKeyDown={(event) => event.stopPropagation()} />
    </div>
    {questions.map((question, index) => <fieldset key={index} disabled={disabled || busy}>
      <legend>{question.title}</legend>
      {Boolean(question.options?.length) && <Radio.Group value={answers[index]} disabled={disabled || busy}
        onChange={(event) => setAnswer(index, event.target.value)}>
        {question.options?.map((option) => <Radio key={option} value={option}>{option}</Radio>)}
      </Radio.Group>}
      <Input.TextArea aria-label={question.title} placeholder={uiText("client.composer.typeYourAnswerAndPressEnterToSend")}
        autoSize={{ minRows: 1, maxRows: 4 }} disabled={disabled || busy}
        value={answers[index] ?? ""} onChange={(event) => setAnswer(index, event.target.value)} />
    </fieldset>)}
    <div className={styles.footer}>
      <small className={styles.hint}>{uiText("client.chat.enterToSendShiftEnterForANewLine")}</small>
      <Button type="primary" loading={busy} disabled={!canSubmit || busy} onClick={() => void submit()}>
        {uiText("client.composer.confirm")}</Button>
    </div>
  </section>;
}
