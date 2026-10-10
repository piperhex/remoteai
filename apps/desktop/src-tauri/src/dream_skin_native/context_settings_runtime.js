const CONTEXT_STORAGE_PREFIX = "codex-switch.context-capacity.v1:";
const CONTEXT_REQUEST_TIMEOUT = 15_000;

function readContextCapacity(id) {
  const raw = localStorage.getItem(CONTEXT_STORAGE_PREFIX + id);
  if (raw === null) return null;
  const capacity = Number(raw);
  if (!Number.isSafeInteger(capacity) || capacity < MIN_CONTEXT_K * TOKENS_PER_K
    || capacity > MAX_CONTEXT_K * TOKENS_PER_K) throw new Error("invalid-capacity");
  return capacity;
}

function persistContextCapacity(id, capacity) {
  if (capacity === null) localStorage.removeItem(CONTEXT_STORAGE_PREFIX + id);
  else localStorage.setItem(CONTEXT_STORAGE_PREFIX + id, String(capacity));
}

function registryInValue(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return null;
  if (typeof value.getImplForHostId === "function" && typeof value.addRegistryCallback === "function") return value;
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const found = registryInValue(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function registryInFiber(fiber) {
  const candidates = [fiber.memoizedProps?.value, fiber.updateQueue?.memoCache?.data];
  let hook = fiber.memoizedState;
  for (let count = 0; hook && count < 100; count += 1, hook = hook.next) {
    candidates.push(hook.memoizedState);
  }
  return registryInValue(candidates);
}

async function findContextRegistry(isDisposed) {
  const root = window.__codexRoot?._internalRoot?.current;
  const queue = root ? [root] : [];
  for (let count = 0; queue.length && count < 10_000 && !isDisposed(); count += 1) {
    const fiber = queue.pop();
    const registry = registryInFiber(fiber);
    if (registry) return registry;
    if (fiber.sibling) queue.push(fiber.sibling);
    if (fiber.child) queue.push(fiber.child);
    if (count % 200 === 199) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return null;
}

function createContextRuntime() {
  let disposed = false;
  let registry = null;
  let adapter = null;
  let discovery = null;
  let nextDiscovery = 0;
  const refresh = () => {
    if (disposed || discovery || Date.now() < nextDiscovery) return;
    nextDiscovery = Date.now() + 5000;
    discovery = (async () => {
      registry ??= await findContextRegistry(() => disposed);
      if (disposed) return;
      const manager = registry?.getImplForHostId("local");
      if (manager === adapter?.manager) return;
      adapter?.dispose();
      adapter = isContextManager(manager) ? createContextAdapter(manager) : null;
    })().catch(() => { /* A changed native runtime leaves settings unavailable; usage still works. */ })
      .finally(() => { discovery = null; });
  };
  refresh();
  return {
    refresh,
    async forThread(id) {
      refresh();
      await discovery;
      if (disposed || !id || !adapter?.manager.getConversation(id)) throw new Error("unavailable");
      return adapter;
    },
    dispose() { disposed = true; adapter?.dispose(); },
  };
}

function isContextManager(manager) {
  return manager && typeof manager.getConversation === "function"
    && typeof manager.requestClient?.sendRequest === "function"
    && typeof manager.resumeConversation === "function" && typeof manager.updateConversationState === "function";
}

