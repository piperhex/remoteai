// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import { setGuiLanguage } from "../../../../../shared/localization/uiText";
import CozePage from "./CozePage";

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isDesktopApp: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setGuiLanguage("zh");
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  setGuiLanguage("zh");
  vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it("shows desktop runtime errors in the interface language", async () => {
  vi.mocked(invoke).mockRejectedValue("当前设备暂不支持 Coze。");
  await act(async () => root.render(<CozePage active />));
  expect(host.querySelector(".ant-alert")?.textContent).toBe("当前设备暂不支持 Coze。");
  await act(async () => setGuiLanguage("ru"));
  expect(host.querySelector(".ant-alert")?.textContent).toBe("Coze пока не поддерживается на этом устройстве.");
  await act(async () => setGuiLanguage("en"));
  expect(host.querySelector(".ant-alert")?.textContent).toBe("Coze is not supported on this device yet.");
});
