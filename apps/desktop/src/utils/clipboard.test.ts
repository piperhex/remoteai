// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { copyText } from "../../../../shared/clipboard";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses the browser clipboard when available", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await copyText("selected-key");
  expect(writeText).toHaveBeenCalledWith("selected-key");
  expect(document.querySelector("textarea")).toBeNull();
});

it.each([false, true])("copies on HTTP or after Clipboard API rejection (%s)", async (rejected) => {
  vi.stubGlobal("navigator", rejected
    ? { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } } : {});
  document.body.innerHTML = '<button>Copy</button>';
  const button = document.querySelector("button")!;
  button.focus();
  const copy = vi.fn(() => {
    expect(document.querySelector("textarea")?.value).toBe("selected-key");
    return true;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: copy });
  await copyText("selected-key");
  expect(copy).toHaveBeenCalledWith("copy");
  expect(document.querySelector("textarea")).toBeNull();
  expect(document.activeElement).toBe(button);
});

it("reports failed copying and removes the temporary secret", async () => {
  vi.stubGlobal("navigator", {});
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
  await expect(copyText("selected-key")).rejects.toThrow("Could not copy");
  expect(document.querySelector("textarea")).toBeNull();
});
