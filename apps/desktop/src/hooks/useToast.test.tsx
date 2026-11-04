import { resources as clientResources } from '@remoteai/i18n/client';
const english: Readonly<Record<string, string>> = clientResources.en;
const russian: Readonly<Record<string, string>> = clientResources.ru;
// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


import { formatRemoteError } from "../../../../shared/localization/errors";
import { setGuiLanguage } from "../../../../shared/localization/uiText";
import { useToast } from "./useToast";

const api = vi.hoisted(() => ({
  recordToastLog: vi.fn(() => Promise.resolve()),
  syncCodexNotification: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("../api/errorLogs", () => ({ recordToastLog: api.recordToastLog }));
vi.mock("../api/backend", () => ({ syncCodexNotification: api.syncCodexNotification }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));

const BACKEND_MESSAGE = "无法读取配置";
const chinese = /[一-鿿]/;

const ToastProbe = forwardRef<(message: string) => void>(function ToastProbe(_props, ref) {
  const { message, notify } = useToast();
  useImperativeHandle(ref, () => notify, [notify]);
  return <output>{message ?? ""}</output>;
});

let container: HTMLDivElement;
let root: Root;
let notify: ((message: string) => void) | null = null;

beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ToastProbe ref={(value) => { notify = value; }} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setGuiLanguage("zh");
});

const show = async (message: string) => act(async () => notify?.(message));

describe("useToast", () => {
  it("shows backend messages in the interface language and logs the original text", async () => {
    await act(async () => setGuiLanguage("ru"));
    await show(BACKEND_MESSAGE);

    expect(russian["client.configEditor.couldNotLoadConfiguration"]).toBeTruthy();
    expect(container.textContent).toBe(russian["client.configEditor.couldNotLoadConfiguration"]);
    expect(api.recordToastLog).toHaveBeenCalledWith(BACKEND_MESSAGE);
    expect(api.syncCodexNotification).toHaveBeenCalledWith(russian["client.configEditor.couldNotLoadConfiguration"]);
  });

  it("follows a language change while the toast is visible", async () => {
    await act(async () => setGuiLanguage("ru"));
    await show(BACKEND_MESSAGE);
    await act(async () => setGuiLanguage("en"));

    expect(container.textContent).toBe(english["client.configEditor.couldNotLoadConfiguration"]);
  });

  it("leaves Chinese and already translated toasts unchanged", async () => {
    await show(BACKEND_MESSAGE);
    expect(container.textContent).toBe(BACKEND_MESSAGE);

    await act(async () => setGuiLanguage("ru"));
    await show(russian["client.configEditor.couldNotLoadConfiguration"]);
    expect(container.textContent).toBe(russian["client.configEditor.couldNotLoadConfiguration"]);
    expect(api.recordToastLog).toHaveBeenLastCalledWith(russian["client.configEditor.couldNotLoadConfiguration"]);
  });

  it("does not change translated dictionary text when it is translated again", () => {
    for (const [language, dictionary] of [["en", english], ["ru", russian]] as const) {
      const changed = Object.values(dictionary)
        .map(String)
        .filter((value) => !chinese.test(value) && formatRemoteError(language, value) !== value);
      expect(changed, language).toEqual([]);
    }
  });
});
