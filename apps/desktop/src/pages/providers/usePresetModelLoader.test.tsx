// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePresetModelLoader } from "./usePresetModelLoader";

const backend = vi.hoisted(() => ({ fetchPresetModels: vi.fn() }));
vi.mock("../../api/backend", () => backend);
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));

function Fixture({ region, onModels, providerId }: {
  region: string; onModels: (models: string[]) => void; providerId?: string;
}) {
  const loader = usePresetModelLoader({
    presetId: "openRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "test-api-key",
    requestOptions: { headers: { "x-region": region }, body: {}, useFullUrl: false },
    providerId, apiKeyRequired: true, savedCredentialAvailable: Boolean(providerId), modelsAvailable: true,
    fallbackModels: [], onModels, t: (key) => key,
  });
  return <button onClick={() => void loader.loadModels()}>{String(loader.loading)}</button>;
}

it("queues changed request headers without overlapping queries or applying stale model lists", async () => {
  backend.fetchPresetModels.mockReset();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const onModels = vi.fn();
  let finish: (models: string[]) => void = () => {};
  backend.fetchPresetModels.mockReturnValueOnce(new Promise<string[]>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(["fresh"]);
  try {
    await act(async () => root.render(<Fixture region="east" onModels={onModels} />));
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(backend.fetchPresetModels).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Fixture region="west" onModels={onModels} />));
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(backend.fetchPresetModels).toHaveBeenCalledTimes(1);
    await act(async () => finish(["stale"]));
    expect(backend.fetchPresetModels).toHaveBeenCalledTimes(2);
    expect(backend.fetchPresetModels.mock.calls[1][0].requestOptions.headers).toEqual({ "x-region": "west" });
    expect(onModels).toHaveBeenCalledExactlyOnceWith(["fresh"]);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("keeps saved providers manual and discards pending results after changing the edited provider", async () => {
  backend.fetchPresetModels.mockReset();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const onModels = vi.fn();
  let finish: (models: string[]) => void = () => {};
  backend.fetchPresetModels.mockReturnValueOnce(new Promise<string[]>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(["fresh"]);
  try {
    await act(async () => root.render(<Fixture region="east" providerId="first" onModels={onModels} />));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(backend.fetchPresetModels).not.toHaveBeenCalled();
    await act(async () => container.querySelector("button")!.click());
    expect(backend.fetchPresetModels).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Fixture region="east" providerId="second" onModels={onModels} />));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await act(async () => finish(["stale"]));
    expect(onModels).not.toHaveBeenCalled();
    expect(backend.fetchPresetModels).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector("button")!.click());
    expect(backend.fetchPresetModels.mock.calls[1][0].providerId).toBe("second");
    expect(onModels).toHaveBeenCalledExactlyOnceWith(["fresh"]);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
