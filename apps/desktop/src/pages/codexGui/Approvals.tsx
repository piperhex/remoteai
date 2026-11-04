import { uiText } from "../../../../../shared/localization/uiText";
import { useRef, useState } from "react";
import { Button, Input, Radio } from "antd";
import { ShieldQuestion } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiEvent } from "../../../../../shared/conversation/types";
import { submitQuestionOnEnter } from "./questionKeyboard";
import { mcpConfirmation } from "./mcpConfirmation";
import styles from "../../../../../shared/conversation/styles.module.less";

type ApprovalController = Pick<GuiController, "respond">;

export function Approvals({ events, controller }: { events: GuiEvent[]; controller: ApprovalController }) {
  return <div className={`${styles.approvals} ${styles.questionWrap}`}>{events.map((event) =>
    <Approval key={event.id} event={event} controller={controller} />)}</div>;
}

function Approval({ event, controller }: { event: GuiEvent; controller: ApprovalController }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const { params, method, id } = event;
  if (id == null) return null;
  const questions = params.questions ?? [];
  const isQuestion = method === "item/tool/requestUserInput";
  const isPermissions = method === "item/permissions/requestApproval";
  const confirmation = mcpConfirmation(params);
  const decisions = params.availableDecisions;
  const allowAccept = !decisions || decisions.includes("accept");
  const allowDecline = !decisions || decisions.includes("decline");
  const respond = async (decision: "accept" | "decline" | "cancel") => {
    if (submitting.current || (isQuestion && questions.some((question) => !answers[question.id]?.trim()))) return;
    submitting.current = true;
    setBusy(true);
    try {
      await controller.respond(isQuestion ? { id, answers: Object.fromEntries(questions.map((question) =>
        [question.id, { answers: answers[question.id]?.trim() ? [answers[question.id].trim()] : [] }])) }
        : { id, decision });
    } finally { submitting.current = false; setBusy(false); }
  };
  return <div className={`${styles.approval} ${isQuestion ? styles.questionCard : ""}`}
    onKeyDown={isQuestion ? (event) => submitQuestionOnEnter(event, () => respond("accept")) : undefined}>
    <strong><ShieldQuestion size={17} />{isQuestion ? uiText("client.chat.moreInformationNeeded") : uiText("client.chat.yourApprovalIsNeeded")}</strong>
    {params.reason && <p>{params.reason}</p>}
    {method === "mcpServer/elicitation/request" && <div style={{ maxWidth: 400, overflowWrap: "anywhere" }}>
      <p>{confirmation.message}</p>
      {confirmation.details.map(({ label, value }) => <p key={label}>{label}：{value}</p>)}
    </div>}
    {params.command && <pre>{params.command}</pre>}
    {(params.cwd || params.grantRoot) && <p className={styles.muted}>{params.cwd || params.grantRoot}</p>}
    {isPermissions && <div>
      {params.permissions?.network?.enabled && <p>{uiText("client.chat.networkAccess")}</p>}
      {params.permissions?.fileSystem?.read?.map((path) => <p key={path}>{uiText("client.chat.read")}{path}</p>)}
      {params.permissions?.fileSystem?.write?.map((path) => <p key={path}>{uiText("client.chat.edit")}{path}</p>)}
      {params.permissions?.fileSystem?.entries &&
        <pre>{JSON.stringify(params.permissions.fileSystem.entries, null, 2)}</pre>}
    </div>}
    {questions.map((question) => <div className={styles.question} key={question.id}>
      <label>{question.question}</label>
      {question.options && <Radio.Group disabled={busy} value={answers[question.id]} onChange={(event) =>
        setAnswers((values) => ({ ...values, [question.id]: event.target.value }))}>
        {question.options.map((option) => <Radio key={option.label} value={option.label}>
          {option.label}<small>{option.description}</small>
        </Radio>)}
      </Radio.Group>}
      <Input disabled={busy} type={question.isSecret ? "password" : "text"} value={answers[question.id] ?? ""}
        placeholder={uiText("client.composer.typeYourAnswerAndPressEnterToSend")} aria-label={question.question}
        onChange={(event) => setAnswers((values) => ({ ...values, [question.id]: event.target.value }))} />
    </div>)}
    {isQuestion ? <p className={styles.muted}>{uiText("client.composer.enterToSend")}</p> : <div className={styles.approvalActions}>
      {allowAccept && <Button type="primary" loading={busy} onClick={() => void respond("accept")}>{uiText("client.chat.allowOnce")}</Button>}
      <Button disabled={busy} onClick={() => void respond(allowDecline ? "decline" : "cancel")}>{uiText("client.chat.deny")}</Button>
    </div>}
  </div>;
}
