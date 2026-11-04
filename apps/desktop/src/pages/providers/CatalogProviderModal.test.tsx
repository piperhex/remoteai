// @vitest-environment jsdom
import { act, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type TextareaHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Provider } from "../../types";
import { CatalogProviderModal } from "./CatalogProviderModal";

const backend = vi.hoisted(() => ({ fetchPresetModels: vi.fn() }));
vi.mock("../../api/backend", () => backend);
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));

vi.mock("antd", () => ({
  Button: ({ children, disabled, onClick }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button disabled={disabled} onClick={onClick}>{children}</button>
  ),
  Input: Object.assign((props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />, {
    Password: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    TextArea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  }),
  Select: () => null,
  Checkbox: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
it("preserves manual models and their protocol overrides when opening and editing a saved preset", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  backend.fetchPresetModels.mockReset().mockResolvedValue(["discovered-model"]);
  const provider: Provider = {
    id: "preset", kind: "custom", name: "OpenRouter", group: "", baseUrl: "https://openrouter.ai/api/v1",
    model: "manual-model", models: ["manual-model"], modelReasoningEfforts: {}, modelContextWindows: {},
    modelApiFormats: { "manual-model": "openaiChat", removed: "anthropicMessages" },
    imageInputModels: [], imageInputModelsConfigured: false, modelSelectionControlledByCodex: true,
    fastModeEnabled: false, apiFormat: "openaiResponses", active: false, autoSwitchEnabled: false, hasApiKey: true,
    supportsDirectSwitch: false, balanceQueryUsesApiKey: true, hasBalanceQueryToken: false,
    hasWalletQueryToken: false, hasWalletLoginCredentials: false,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const save = vi.fn().mockResolvedValue(provider);
  try {
    await act(async () => root.render(<CatalogProviderModal presetId="openRouter" provider={provider}
      saving={false} onClose={vi.fn()} onSave={save} t={(key) => key} />));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(backend.fetchPresetModels).not.toHaveBeenCalled();
    const headers = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
        .call(headers, '{"x-region":"west"}');
      headers.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(backend.fetchPresetModels).not.toHaveBeenCalled();
    const button = [...container.querySelectorAll("button")].find((button) => button.textContent === "providers.form.save");
    expect(button?.disabled).toBe(false);
    await act(async () => button!.click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      model: "manual-model", models: ["manual-model"], modelApiFormats: { "manual-model": "openaiChat" },
      requestOptions: { useFullUrl: false, headers: { "x-region": "west" }, body: {} },
    }));
    const refresh = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "providers.catalog.fetchModels")!;
    await act(async () => refresh.click());
    expect(backend.fetchPresetModels).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      providerId: "preset", requestOptions: { useFullUrl: false, headers: { "x-region": "west" }, body: {} },
    }), expect.any(Array));
    await act(async () => button!.click());
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      model: "discovered-model", models: ["discovered-model"], modelApiFormats: {},
    }));
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
