// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNonProxyEnhancements } from "./useNonProxyEnhancements";

const backend = vi.hoisted(() => ({ loadAppSettings: vi.fn(), updateNonProxyEnhancements: vi.fn() }));
vi.mock("../api/backend", () => backend);
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));

let container: HTMLDivElement;
let root: Root;
function Setting() {
  const setting = useNonProxyEnhancements();
  return <><button disabled={setting.loading} onClick={() => { void setting.update(!setting.enabled); }}>
    {String(setting.enabled)}</button><span role="alert">{setting.error}</span></>;
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  root = createRoot(container);
  backend.loadAppSettings.mockResolvedValue({});
});
afterEach(async () => { await act(async () => root.unmount()); });

it("keeps the existing behavior for users without a saved preference", async () => {
  await act(async () => root.render(<Setting />));
  expect(container.querySelector("button")?.textContent).toBe("true");
});

it("loads the saved off state and waits for a successful save before changing the switch", async () => {
  backend.loadAppSettings.mockResolvedValue({ nonProxyEnhancementsEnabled: false });
  let finish!: (value: { nonProxyEnhancementsEnabled: boolean }) => void;
  backend.updateNonProxyEnhancements.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Setting />));
  const button = container.querySelector("button")!;
  expect(button.textContent).toBe("false");
  await act(async () => button.click());
  expect(backend.updateNonProxyEnhancements).toHaveBeenCalledWith(true);
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe("false");
  await act(async () => finish({ nonProxyEnhancementsEnabled: true }));
  expect(button.textContent).toBe("true");
  expect(button.disabled).toBe(false);
});

it("keeps the prior setting and reports a failed save", async () => {
  backend.updateNonProxyEnhancements.mockRejectedValue(new Error("save failed"));
  await act(async () => root.render(<Setting />));
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("button")?.textContent).toBe("true");
  expect(container.querySelector("[role=alert]")?.textContent).toBe("save");
});
