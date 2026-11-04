import { invoke } from "../../api/backend";
import { subscribeGuiEvent } from "../../../../../shared/conversation/webEvents";
import type { ModelSettingsApi, ModelSettingsSnapshot } from "./threadModelSettings";

export const modelSettingsApi: ModelSettingsApi = {
  read: (threadId) => invoke<ModelSettingsSnapshot>("codex_gui_model_settings", { threadId }),
  write: (threadId, selection) => invoke<ModelSettingsSnapshot>("codex_gui_set_model_settings", { threadId, selection }),
  subscribe: (receive) => subscribeGuiEvent("codex-gui-model-settings-changed", receive),
};
