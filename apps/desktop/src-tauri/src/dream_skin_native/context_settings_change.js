const CONTEXT_INTERRUPT_TIMEOUT = 10_000;
const CONTEXT_STATUS_POLL = 100;
const CONTEXT_CONTINUE_TEXT = "请继续完成刚才中断的任务。";

function contextIdle(id, snapshot) {
  if (snapshot.thread?.id !== id) throw new Error("thread-mismatch");
  const status = snapshot.thread.status?.type;
  if (!["idle", "notLoaded", "active"].includes(status)) throw new Error("unavailable");
  return status !== "active";
}

function contextResumeParams(id, snapshot) {
  const params = { threadId: id, excludeTurns: true, config: {} };
  for (const key of ["model", "modelProvider", "serviceTier", "cwd", "runtimeWorkspaceRoots",
    "approvalPolicy", "approvalsReviewer"]) {
    if (Object.hasOwn(snapshot, key)) params[key] = snapshot[key];
  }
  if (snapshot.reasoningEffort != null) params.config.model_reasoning_effort = snapshot.reasoningEffort;
  if (snapshot.activePermissionProfile?.id) params.permissions = snapshot.activePermissionProfile.id;
  else {
    const modes = { readOnly: "read-only", workspaceWrite: "workspace-write", dangerFullAccess: "danger-full-access" };
    params.sandbox = modes[snapshot.sandbox?.type];
    if (!params.sandbox) throw new Error("unsupported-permissions");
  }
  return params;
}

async function reloadContextCapacity({ raw, rejoin, id, capacity, previous }) {
  const snapshot = await raw("thread/resume", { threadId: id, excludeTurns: true });
  if (!contextIdle(id, snapshot)) throw new Error("busy");
  // Validate before unloading; unsupported permission shapes must leave the conversation untouched.
  contextResumeParams(id, snapshot);
  const resume = async value => {
    await rejoin(snapshot, value);
    const permissions = snapshot.activePermissionProfile?.id;
    await raw("thread/settings/update", { threadId: id,
      ...(permissions ? { permissions } : { sandboxPolicy: snapshot.sandbox }) });
  };
  await raw("thread/unsubscribe", { threadId: id });
  try { await resume(capacity); }
  catch (error) {
    try {
      const latest = await raw("thread/read", { threadId: id, includeTurns: false });
      if (!contextIdle(id, latest)) throw new Error("busy");
      await raw("thread/unsubscribe", { threadId: id });
      await resume(previous);
    }
    catch { throw new Error("restore-failed", { cause: error }); }
    throw error;
  }
  return snapshot;
}

async function contextActiveTurn(raw, id) {
  const result = await raw("thread/turns/list", {
    threadId: id, limit: 1, sortDirection: "desc", itemsView: "notLoaded",
  });
  return result.data?.find(turn => turn.status === "inProgress")?.id ?? null;
}

async function contextManualStop({ raw, id, params }) {
  const active = await contextActiveTurn(raw, id);
  if (!active) return {};
  return raw("turn/interrupt", { ...params, turnId: active });
}

async function pauseContextTurn(raw, id, snapshot) {
  if (contextIdle(id, snapshot)) return false;
  const turnId = await contextActiveTurn(raw, id);
  if (!turnId) throw new Error("busy");
  try { await raw("turn/interrupt", { threadId: id, turnId }); }
  catch (error) {
    if (contextIdle(id, await raw("thread/read", { threadId: id, includeTurns: false }))) return false;
    throw error;
  }
  const deadline = Date.now() + CONTEXT_INTERRUPT_TIMEOUT;
  while (Date.now() < deadline) {
    const state = await raw("thread/read", { threadId: id, includeTurns: false });
    if (contextIdle(id, state)) return true;
    await new Promise(resolve => setTimeout(resolve, CONTEXT_STATUS_POLL));
  }
  throw new Error("interrupt-timeout");
}

function contextContinuationOverrides(params) {
  const result = {};
  for (const key of ["summary", "personality", "outputSchema", "collaborationMode", "serviceTierForTurn"]) {
    if (Object.hasOwn(params, key)) result[key] = params[key];
  }
  return result;
}

function contextContinuation(id, snapshot, previous) {
  const params = { ...previous, threadId: id, input: [{ type: "text", text: CONTEXT_CONTINUE_TEXT }] };
  if (snapshot.collaborationMode) params.collaborationMode = snapshot.collaborationMode;
  for (const key of ["model", "serviceTier", "approvalPolicy", "approvalsReviewer"]) {
    if (Object.hasOwn(snapshot, key)) params[key] = snapshot[key];
  }
  params.effort = snapshot.reasoningEffort;
  if (params.collaborationMode?.settings) {
    params.collaborationMode = { ...params.collaborationMode, settings: { ...params.collaborationMode.settings,
      model: snapshot.model, reasoning_effort: snapshot.reasoningEffort } };
  }
  return params;
}

async function changeContextCapacity({ raw, rejoin, id, capacity, current, isDisposed }) {
  if (isDisposed()) throw new Error("unavailable");
  const previous = readContextCapacity(id);
  if (previous === capacity && current.applied === capacity) return "applied";
  const stops = current.stops;
  const snapshot = await raw("thread/resume", { threadId: id, excludeTurns: true });
  const interrupted = await pauseContextTurn(raw, id, snapshot);
  if (isDisposed()) throw new Error("unavailable");
  await reloadContextCapacity({ raw, rejoin, id, capacity, previous });
  try { persistContextCapacity(id, capacity); }
  catch (error) {
    await reloadContextCapacity({ raw, rejoin, id, capacity: previous, previous: capacity });
    throw error;
  }
  current.applied = capacity;
  if (!interrupted) return "applied";
  if (isDisposed() || current.stops !== stops) return "paused";
  try { await raw("turn/start", contextContinuation(id, snapshot, current.previousTurn)); }
  catch { return "resumeFailed"; }
  return "continued";
}
