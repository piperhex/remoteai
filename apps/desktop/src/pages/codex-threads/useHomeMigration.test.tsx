// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrateCodexThreadsToHome } from "../../api/backend";
import { useHomeMigration } from "./useHomeMigration";

vi.mock("../../components/CodexHomeScope", () => ({
  useSelectedCodexHome: () => "source",
  useCodexHomes: () => [{ id: "source" }, { id: "target" }, { id: "third" }, { id: "codex-gui" }],
}));
vi.mock("../../api/backend", () => ({ migrateCodexThreadsToHome: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
let root: Root;
let migration: ReturnType<typeof useHomeMigration>;
const selected = new Set(["one", "two"]);
const clearSelection = vi.fn();
const refresh = vi.fn(async () => {});
const reportError = vi.fn();
const setBusy = vi.fn();
const onMigrated = vi.fn();
function Harness({ fixedTargetHomeId }: { fixedTargetHomeId?: string }) {
  migration = useHomeMigration({ selected, clearSelection, refresh, reportError, setBusy,
    notify: vi.fn(), onMigrated, fixedTargetHomeId });
  return null;
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  vi.mocked(migrateCodexThreadsToHome).mockResolvedValue({
    requestedCount: 2, migratedCount: 2, skippedCount: 0, message: "Moved",
  });
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("moves captured selection from the current home to the chosen destination", async () => {
  await act(async () => migration.show());
  expect(migration.homes.map((home) => home.id)).toEqual(["target", "third", "codex-gui"]);
  await act(async () => migration.setTargetHomeId("third"));
  await act(async () => migration.commit());
  expect(migrateCodexThreadsToHome).toHaveBeenCalledWith({
    homeId: "source", targetHomeId: "third", sessionIds: ["one", "two"],
    modelProvider: "openai",
  });
  expect(clearSelection).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledOnce();
  expect(migration.open).toBe(false);
  expect(onMigrated).toHaveBeenCalledExactlyOnceWith("third");
});

it("refreshes partial failure while retaining the dialog and selection", async () => {
  vi.mocked(migrateCodexThreadsToHome).mockRejectedValue(new Error("failed"));
  await act(async () => migration.show());
  await act(async () => migration.commit());
  expect(reportError).toHaveBeenCalledOnce();
  expect(clearSelection).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledOnce();
  expect(migration.open).toBe(true);
  expect(migration.error).toBe("failed");
  expect(setBusy).toHaveBeenLastCalledWith(false);
  expect(onMigrated).not.toHaveBeenCalled();
});

it("ignores a second click while migration is in flight", async () => {
  let finish: (() => void) | undefined;
  vi.mocked(migrateCodexThreadsToHome).mockImplementation(() => new Promise((resolve) => {
    finish = () => resolve({ requestedCount: 2, migratedCount: 2, skippedCount: 0, message: "Moved" });
  }));
  await act(async () => migration.show());
  await act(async () => {
    const first = migration.commit();
    await migration.commit();
    expect(migrateCodexThreadsToHome).toHaveBeenCalledOnce();
    finish?.();
    await first;
  });
});

it("uses the fixed GUI destination regardless of home order or destination selection", async () => {
  await act(async () => root.render(<Harness fixedTargetHomeId="codex-gui" />));
  await act(async () => migration.show());
  expect(migration.fixedTarget).toBe(true);
  expect(migration.sourceHome?.id).toBe("source");
  expect(migration.targetHome?.id).toBe("codex-gui");
  expect(migrateCodexThreadsToHome).not.toHaveBeenCalled();
  await act(async () => migration.setTargetHomeId("third"));
  await act(async () => migration.commit());
  expect(migrateCodexThreadsToHome).toHaveBeenCalledExactlyOnceWith({
    homeId: "source", targetHomeId: "codex-gui", sessionIds: ["one", "two"],
    modelProvider: "codex-switch-gui",
  });
  expect(onMigrated).toHaveBeenCalledExactlyOnceWith("codex-gui");
});

it.each(["unavailable", "source"])("does not substitute another home for invalid fixed target %s", async (id) => {
  await act(async () => root.render(<Harness fixedTargetHomeId={id} />));
  await act(async () => migration.show());
  await act(async () => migration.commit());
  expect(migrateCodexThreadsToHome).not.toHaveBeenCalled();
  expect(migration.targetHome).toBeUndefined();
  expect(migration.open).toBe(true);
});

it.each(["openai", "codex-switch-local", "codex-switch-gui"] as const)(
  "migrates using the explicitly selected provider %s", async (modelProvider) => {
    await act(async () => root.render(<Harness fixedTargetHomeId="codex-gui" />));
    await act(async () => migration.show());
    await act(async () => migration.setModelProvider(modelProvider));
    await act(async () => migration.commit());
    expect(migrateCodexThreadsToHome).toHaveBeenCalledExactlyOnceWith({
      homeId: "source", targetHomeId: "codex-gui", sessionIds: ["one", "two"], modelProvider,
    });
  },
);

it("resets the provider for a new destination and when reopening the dialog", async () => {
  await act(async () => migration.show());
  await act(async () => migration.setTargetHomeId("codex-gui"));
  expect(migration.modelProvider).toBe("codex-switch-gui");
  await act(async () => migration.setTargetHomeId("third"));
  expect(migration.modelProvider).toBe("openai");
  await act(async () => migration.setModelProvider("codex-switch-local"));
  await act(async () => migration.show());
  expect(migration.modelProvider).toBe("openai");
});
