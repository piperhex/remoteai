// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { guiFontStyle, normalizeGuiFontSize, saveGuiFontSize, useGuiFontSize } from "../../../../../shared/conversation/guiAppearance";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("bounds font sizes and ignores invalid saved values", () => {
  expect(normalizeGuiFontSize(8)).toBe(12);
  expect(normalizeGuiFontSize(100)).toBe(24);
  expect(normalizeGuiFontSize(17.6)).toBe(18);
  for (const value of [null, "20", NaN, Infinity, {}]) expect(normalizeGuiFontSize(value)).toBe(14);
});

it("updates mounted conversations immediately and preserves the size after remounting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  let root = createRoot(container);
  function Conversation() {
    const fontSize = useGuiFontSize();
    return <div style={guiFontStyle(fontSize)}>{fontSize}</div>;
  }
  try {
    await act(async () => root.render(<Conversation />));
    expect(container.textContent).toBe("14");
    await act(async () => { expect(saveGuiFontSize(20)).toBe(true); });
    expect(container.firstElementChild?.getAttribute("style")).toContain("--gui-font-size: 20px");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<Conversation />));
    expect(container.textContent).toBe("20");
    await act(async () => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(container.textContent).toBe("14");
  } finally { await act(async () => root.unmount()); }
});

it("reports persistence failures without claiming that the size was saved", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
  expect(saveGuiFontSize(18)).toBe(false);
});
