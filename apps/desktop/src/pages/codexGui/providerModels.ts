import type { AggregateApi, Provider } from "../../types";
import { defaultReasoningEfforts, normalizeModels } from "../providers/providerUtils";
import type { Model } from "../../../../../shared/conversation/types";

function modelOption(model: string, preferred: string, efforts = defaultReasoningEfforts(model)): Model {
  return {
    id: model, model, displayName: model, isDefault: model === preferred,
    defaultReasoningEffort: efforts.includes("high") ? "high" : efforts.at(-1) ?? "none",
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: "" })),
  };
}

/** A null catalog uses Codex's account catalog; an empty catalog must stay empty. */
export function providerModels(providers: Provider[], aggregates: AggregateApi[]): Model[] | null {
  const aggregate = aggregates.find((entry) => entry.active);
  if (aggregate) {
    const members = providers.filter((entry) => aggregate.memberProviderIds.includes(entry.id));
    const configured = members.map((entry) => entry.modelReasoningEfforts[
      aggregate.memberModels?.[entry.id] ?? aggregate.model] ?? []);
    const efforts = configured[0]?.filter((effort) => configured.every((levels) => levels.includes(effort))) ?? [];
    return normalizeModels(aggregate.model, []).map((model) =>
      modelOption(model, aggregate.model, efforts.length ? efforts : undefined));
  }
  const provider = providers.find((entry) => entry.active && entry.kind === "custom");
  if (!provider) return null;
  // A fixed Provider rewrites every request to its selected model.
  const models = normalizeModels(provider.model, provider.modelSelectionControlledByCodex ? provider.models : []);
  return models.map((model) => modelOption(model, provider.model, provider.modelReasoningEfforts[model]));
}
