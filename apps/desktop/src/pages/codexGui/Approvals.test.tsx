// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Approvals } from "./Approvals";
import type { GuiEvent } from "../../../../../shared/conversation/types";

let root: Root;
let container: HTMLDivElement;
const respond = vi.fn();
const event: GuiEvent = { id: 19, method: "mcpServer/elicitation/request", params: {
  serverName: "codex_switch_chrome", message: 'Allow the server to run tool "browser_open"?',
  _meta: { tool_params: { browserId: "internal-profile", url: "http://localhost/fixture" } },
} };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  root = createRoot(container);
  respond.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); });

it.each([["允许这一次", "accept"], ["拒绝", "decline"]])(
  "discloses the requested action and sends %s only after a click", async (label, decision) => {
    await act(async () => root.render(<Approvals events={[event]} controller={{ respond }} />));
    expect(container.textContent).toContain("允许打开这个网页吗？");
    expect(container.textContent).toContain("http://localhost/fixture");
    expect(container.textContent).not.toContain("internal-profile");
    expect(respond).not.toHaveBeenCalled();
    const button = [...container.querySelectorAll("button")]
      .find((node) => node.textContent?.replace(/\s/g, "") === label);
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(respond).toHaveBeenCalledExactlyOnceWith({ id: 19, decision });
  },
);
