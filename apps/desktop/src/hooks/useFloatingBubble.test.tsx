// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFloatingBubble } from "./useFloatingBubble";

const backend = vi.hoisted(() => ({
  loadAppSettings: vi.fn(),
  updateFloatingBubble: vi.fn(),
  subscribeToFloatingBubbleChanges: vi.fn(),
}));
vi.mock("../api/backend", () => backend);
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));

const notify = vi.fn();
const unsubscribe = vi.fn();
let onChange: (enabled: boolean) => void;
let container: HTMLDivElement;
let root: Root;

function SettingsSwitch() {
  const bubble = useFloatingBubble(notify);
  return <button disabled={bubble.loading} onClick={() => void bubble.setEnabled(!bubble.enabled)}>
    {String(bubble.enabled)}
  </button>;
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  backend.loadAppSettings.mockResolvedValue({ floatingBubbleEnabled: true });
  backend.subscribeToFloatingBubbleChanges.mockImplementation((listener: typeof onChange) => {
    onChange = listener;
    return unsubscribe;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  expect(unsubscribe).toHaveBeenCalledOnce();
  container.remove();
});

it("updates the open settings switch when the tray hides the bubble", async () => {
  await act(async () => root.render(<SettingsSwitch />));
  expect(container.textContent).toBe("true");
  await act(async () => onChange(false));
  expect(container.textContent).toBe("false");
});

it("does not overwrite a newer tray change with a stale initial settings response", async () => {
  let resolveSettings!: (settings: { floatingBubbleEnabled: boolean }) => void;
  backend.loadAppSettings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve; }));
  await act(async () => root.render(<SettingsSwitch />));
  await act(async () => onChange(false));
  await act(async () => resolveSettings({ floatingBubbleEnabled: true }));
  expect(container.textContent).toBe("false");
});

it("keeps the saved setting when window recovery is pending after a command error", async () => {
  backend.loadAppSettings.mockResolvedValueOnce({ floatingBubbleEnabled: false });
  backend.updateFloatingBubble.mockRejectedValue(new Error("Window recovery pending"));
  await act(async () => root.render(<SettingsSwitch />));
  expect(container.textContent).toBe("false");
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toBe("true");
  expect(notify).toHaveBeenCalledOnce();
  expect(container.querySelector("button")!.disabled).toBe(false);
});
