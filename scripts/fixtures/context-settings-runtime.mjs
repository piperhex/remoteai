import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const root = new URL("../../apps/desktop/src-tauri/src/dream_skin_native/", import.meta.url);
const source = (await Promise.all(["context_settings_runtime.js", "context_settings_change.js", "context_settings_adapter.js"]
  .map(file => readFile(new URL(file, root), "utf8")))).join("\n");
const settings = (await readFile(new URL("../../shared/context-usage/settings.js", import.meta.url), "utf8"))
  .replaceAll("export ", "");

export const runtimeScript = `${settings}\n${source}`;

export function createRuntime({ active = false, fail, delay, storageFailure = false } = {}) {
  const calls = [];
  const saved = new Map();
  const statuses = new Map([["one", active ? "active" : "idle"], ["two", "idle"]]);
  const capacities = new Map();
  let turn = "original-turn";
  const request = async (method, params) => {
    calls.push({ method, params });
    await delay?.(method, params);
    if (fail?.(method, params)) throw Error("test-failure");
    const id = params.threadId;
    if (method === "turn/interrupt") statuses.set(id, "idle");
    if (method === "turn/start") { statuses.set(id, "active"); turn = "continued-turn"; }
    if (method === "thread/unsubscribe") capacities.delete(id);
    if (method === "thread/resume" && Object.hasOwn(params, "config")) {
      capacities.set(id, params.config.model_context_window ?? null);
    }
    if (method === "thread/turns/list") return {
      data: [{ id: turn, status: statuses.get(id) === "active" ? "inProgress" : "completed" }],
    };
    return { thread: { id, status: { type: statuses.get(id) ?? "idle" } }, model: "provider-model",
      reasoningEffort: "high", approvalPolicy: "on-request", approvalsReviewer: "user",
      sandbox: { type: "workspaceWrite", writableRoots: ["/project"], networkAccess: false },
      serviceTier: "fast", cwd: "/project" };
  };
  const manager = { getConversation: id => statuses.has(id) ? { id } : null, requestClient: { sendRequest: request } };
  manager.updateConversationState = (id, update) => update({ id });
  manager.interruptConversation = async () => {}; // Native stop may finish locally after the turn is already idle.
  manager.resumeConversation = async ({ conversationId }) => {
    await manager.requestClient.sendRequest("thread/resume", { threadId: conversationId,
      config: { "features.desktop_tools": true }, developerInstructions: "native desktop instructions" });
    return { status: "ready" };
  };
  const localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => { if (storageFailure) throw Error("quota"); saved.set(key, value); },
    removeItem: key => saved.delete(key),
  };
  const context = { manager, localStorage, setTimeout, clearTimeout, console, Date, window: {} };
  const adapter = runInNewContext(`${runtimeScript}\ncreateContextAdapter(manager)`, context);
  return { adapter, manager, calls, saved, statuses, capacities, request, context };
}
