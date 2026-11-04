// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Markdown from "react-markdown";
import { RichText } from "../../../../../shared/conversation/RichText";

vi.mock("react-markdown", async original => {
  const module = await original<typeof import("react-markdown")>();
  return { ...module, default: vi.fn(module.default) };
});

it("reuses completed Markdown when only its message controls change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<RichText text="**Completed response**" trailing={<button>Copy</button>} />));
    expect(Markdown).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<RichText text="**Completed response**" trailing={<button>Copied</button>} />));
    expect(Markdown).toHaveBeenCalledTimes(1);
    expect(container.querySelector("button")?.textContent).toBe("Copied");
    await act(async () => root.render(<RichText text="**Updated response**" />));
    expect(Markdown).toHaveBeenCalledTimes(2);
    expect(container.querySelector("strong")?.textContent).toBe("Updated response");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
