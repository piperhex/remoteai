import { expect, it } from "vitest";
import { modelSelectionError, resolveModelSelection } from "../../../../../shared/conversation/modelSelection";
import type { Model } from "../../../../../shared/conversation/types";

const model: Model = { id: "kimi-k3", model: "kimi-k3", displayName: "Kimi K3", isDefault: true,
  defaultReasoningEffort: "high", supportedReasoningEfforts: ["low", "high", "max"].map((reasoningEffort) =>
    ({ reasoningEffort, description: "" })) };

it("resolves an implicit choice to the default model even when it is not first", () => {
  const other = { ...model, id: "other", model: "other", isDefault: false };
  expect(resolveModelSelection([other, model], { model: "", effort: "" }))
    .toEqual({ model: "kimi-k3", effort: "high" });
});

it("preserves explicit efforts and reports unsupported choices without replacing them", () => {
  expect(resolveModelSelection([model], { model: "kimi-k3", effort: "max" }))
    .toEqual({ model: "kimi-k3", effort: "max" });
  expect(resolveModelSelection([model], { model: "kimi-k3", effort: "ultra" }))
    .toEqual({ model: "kimi-k3", effort: "ultra" });
  expect(modelSelectionError([model], { model: "kimi-k3", effort: "ultra" }))
    .toBe("client.chat.effortUnavailableForAccount");
  expect(modelSelectionError([model], { model: "kimi-k3", effort: "max" })).toBeNull();
});

it("preserves unavailable models and efforts, including when the catalog is empty", () => {
  expect(resolveModelSelection([model], { model: "other", effort: "max" }))
    .toEqual({ model: "other", effort: "max" });
  expect(resolveModelSelection([], { model: "other", effort: "max" }))
    .toEqual({ model: "other", effort: "max" });
  expect(modelSelectionError([model], { model: "other", effort: "max" }))
    .toBe("client.chat.modelUnavailableForAccount");
});

it("handles a model without reasoning and an unavailable catalog without inventing a model", () => {
  expect(resolveModelSelection([{ ...model, defaultReasoningEffort: "none", supportedReasoningEfforts: [] }],
    { model: "", effort: "" })).toEqual({ model: "kimi-k3", effort: "none" });
  expect(resolveModelSelection([], { model: "", effort: "" })).toEqual({ model: "", effort: "" });
});
