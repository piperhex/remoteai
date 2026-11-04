import { uiText } from "../../../../../shared/localization/uiText";
import type { EventParams } from "../../../../../shared/conversation/types";

const CHROME_ACTIONS: Record<string, string> = {
  get browser_open() { return uiText("client.conversation.openThisWebPage"); }, get browser_navigate() { return uiText("client.conversation.goToThisWebPage"); }, get browser_close() { return uiText("client.conversation.closeThisTab"); },
  get browser_reload() { return uiText("client.conversation.reloadPage"); }, get browser_back() { return uiText("client.conversation.goBack"); }, get browser_forward() { return uiText("client.conversation.goForward"); },
  get browser_focus() { return uiText("client.conversation.switchToThisTab"); }, get browser_click() { return uiText("client.conversation.clickAnElementOnThePage"); }, get browser_fill() { return uiText("client.conversation.fillInPageContent"); },
  get browser_type() { return uiText("client.conversation.typeThisText"); }, get browser_key() { return uiText("client.conversation.pressTheseKeys"); }, get browser_select() { return uiText("client.conversation.selectThisOption"); },
  get browser_check() { return uiText("client.conversation.changeTheCheckboxSelection"); }, get browser_scroll() { return uiText("client.conversation.scrollThePage"); }, get browser_drag() { return uiText("client.conversation.dragAnElementOnThePage"); },
};
const PARAMETER_LABELS: Record<string, string> = {
  get url() { return uiText("client.conversation.webPage"); }, get text() { return uiText("client.chat.content"); }, get value() { return uiText("client.chat.content"); }, get values() { return uiText("client.conversation.option"); }, get key() { return uiText("client.conversation.keys"); }, get keys() { return uiText("client.conversation.keys"); },
  get checked() { return uiText("client.conversation.checked"); }, get direction() { return uiText("client.conversation.direction"); }, get amount() { return uiText("client.conversation.distance"); }, get button() { return uiText("client.conversation.mouseButton"); },
};
const PAGE_REFERENCES = new Set(["browserId", "tabId", "ref", "frameId", "fromRef", "toRef"]);

export function mcpConfirmation(params: EventParams) {
  const tool = params.message?.match(/"(browser_[a-z_]+)"/)?.[1];
  const action = params.serverName === "codex_switch_chrome" && tool ? CHROME_ACTIONS[tool] : undefined;
  const entries = Object.entries(params._meta?.tool_params ?? {});
  return {
    message: action ? uiText("client.conversation.allow", { value1: action }) : params.message,
    details: entries.filter(([key]) => !action || !PAGE_REFERENCES.has(key)).map(([key, value]) => ({
      label: action ? PARAMETER_LABELS[key] ?? key : key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    })),
  };
}
