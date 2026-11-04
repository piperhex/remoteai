// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { loadProviderTokenUsage, subscribeToTokenUsageChanges } from "../../api/backend";
import type { Provider, ProviderTokenUsageTotals } from "../../types";
import { useProviderTokenUsage } from "./useProviderTokenUsage";

vi.mock("../../api/backend", () => ({
  loadProviderTokenUsage: vi.fn(),
  subscribeToTokenUsageChanges: vi.fn(),
}));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));

const providers: Provider[] = [];
function Fixture({ active }: { active: boolean }) {
  useProviderTokenUsage(2, providers, active);
  return null;
}

it("stops polling on tab exit and remains single-flight while a request is pending", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const unsubscribe = vi.fn();
  vi.mocked(subscribeToTokenUsageChanges).mockReturnValue(unsubscribe);
  let finish: (totals: ProviderTokenUsageTotals[]) => void = () => {};
  const load = vi.mocked(loadProviderTokenUsage).mockImplementationOnce(
    () => new Promise((resolve) => { finish = resolve; }),
  ).mockResolvedValue([]);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Fixture active={false} />));
    expect(load).not.toHaveBeenCalled();
    await act(async () => root.render(<Fixture active />));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(6_000));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Fixture active={false} />));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await act(async () => finish([]));
    await act(async () => vi.advanceTimersByTime(6_000));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Fixture active />));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(load).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
