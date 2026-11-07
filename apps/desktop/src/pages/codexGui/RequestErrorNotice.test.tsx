// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RequestErrorNotice } from "./RequestErrorNotice";
import type { Turn } from "../../../../../shared/conversation/types";
import type { TurnRequestError } from "../../../../../shared/conversation/turnRequestErrors";
import { setGuiLanguage, uiText } from "../../../../../shared/localization/uiText";

const raw = "Reconnecting... 4/5 unexpected status 502 Bad Gateway: upstream unavailable, "
  + "url: http://localhost:8080/v1/responses";
const record: TurnRequestError = {
  id: "turn:error:0", afterItemId: null, itemCount: 0, willRetry: true,
  error: { message: raw, additionalDetails: "<script>upstream timed out</script>" },
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  setGuiLanguage("zh");
  vi.unstubAllGlobals();
});

const cases = [
  { status: "inProgress", willRetry: true, resumed: false,
    key: "client.chat.connectionInterruptedCodexIsRetrying" },
  { status: "inProgress", willRetry: true, resumed: true,
    key: "client.chat.theConnectionWasInterruptedAndHasRecovered" },
  { status: "completed", willRetry: true, resumed: false,
    key: "client.chat.theConnectionWasInterruptedAndHasRecovered" },
  { status: "interrupted", willRetry: true, resumed: false,
    key: "client.chat.theConnectionWasInterruptedDuringThisReply" },
  { status: "failed", willRetry: false, resumed: false,
    key: "client.chat.thisReplyStoppedBecauseOfAProblem" },
] as const;

for (const language of ["zh", "en", "ja", "ru"] as const) {
  it.each(cases)(`${language}: keeps diagnostics collapsed for $status (resumed=$resumed)`, async sample => {
    setGuiLanguage(language);
    const turn: Turn = { id: "turn", status: sample.status,
      items: sample.resumed ? [{ id: "resumed", type: "agentMessage", text: "Resumed" }] : [] };
    await act(async () => root.render(<RequestErrorNotice turn={turn}
      record={{ ...record, willRetry: sample.willRetry }} />));
    const details = container.querySelector("details")!;
    const summary = details.querySelector("summary")!;
    expect(summary.textContent).toBe(uiText(sample.key));
    expect(container.textContent).not.toContain(raw);
    expect(container.querySelector("pre")).toBeNull();
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    expect(container.querySelector("pre")?.textContent).toContain(raw);
    expect(container.querySelector("script")).toBeNull();
    expect(summary.textContent).not.toContain(raw);
    await act(async () => { details.open = false; details.dispatchEvent(new Event("toggle")); });
    expect(container.textContent).not.toContain(raw);
    expect(container.querySelector("pre")).toBeNull();
  });
}
