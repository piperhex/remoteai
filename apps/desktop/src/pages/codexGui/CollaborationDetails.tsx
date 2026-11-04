import { uiText } from "../../../../../shared/localization/uiText";
import type { Item } from "../../../../../shared/conversation/types";
import { collaborationStates, collaborationStatus, collaborationSummary } from "../../../../../shared/conversation/collaborationActivity";
import { ToolText } from "./ToolText";

export function CollaborationDetails({ item }: { item: Item }) {
  const states = collaborationStates(item);
  return <>
    <p>{collaborationSummary(item)}</p>
    {item.prompt && <ToolText text={item.prompt} markdown />}
    {item.text && item.text !== item.prompt && <ToolText text={item.text} markdown />}
    {states.map((state, index) => <div key={index}>
      <p>{uiText("client.chat.collaboration")} {index + 1} · {collaborationStatus(state.status)}</p>
      {state.message && <ToolText text={state.message} markdown />}
    </div>)}
  </>;
}
