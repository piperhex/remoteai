import { uiText } from "../../../../../shared/localization/uiText";
import { DeferredDetails } from './DeferredDetails';
import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";
import type { Turn } from "../../../../../shared/conversation/types";
import { RichText } from "../../../../../shared/conversation/RichText";
import styles from "./TurnPlan.module.less";

export function TurnPlan({ turn }: { turn: Turn }) {
  if (!turn.plan?.length) return null;
  const completed = turn.plan.filter((step) => step.status === "completed").length;
  return <DeferredDetails key={turn.status === 'inProgress' ? 'running' : 'finished'}
    className={styles.plan} defaultOpen={turn.status === 'inProgress'}
    summary={<summary>{uiText("client.chat.taskPlan")} <span>{completed}/{turn.plan.length}</span></summary>}>
    {() => <>{turn.planExplanation && <RichText text={turn.planExplanation} />}
    <ol>{turn.plan?.map((step, index) => {
      const Icon = step.status === "completed" ? CheckCircle2 : step.status === "inProgress" ? LoaderCircle : Circle;
      return <li key={index} data-status={step.status}><Icon size={15} /><span>{step.step}</span>
        <small>{step.status === "completed" ? uiText("client.chat.completed") : step.status === "inProgress" ? uiText("client.chat.inProgress") : uiText("client.chat.pending")}</small></li>;
    })}</ol></>}
  </DeferredDetails>;
}
