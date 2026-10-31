async function loadNativeUsageService() {
  const links = document.querySelectorAll('link[rel="modulepreload"]');
  const url = [...links].map(link => new URL(link.href, location.href)).find(url =>
    url.protocol === location.protocol && url.host === location.host
    && /^\/assets\/app-shared-[\w-]+\.js$/.test(url.pathname));
  if (!url) return null;
  const exports = await import(url.href);
  return Object.values(exports).find(value => value && typeof value === "object"
    && typeof value.appServerManagers?.subscribe === "function"
    && typeof value.appServerManagers?.openAccount === "function")?.appServerManagers ?? null;
}

function nativeUsageResources() {
  const resources = new Set();
  let disposed = false;
  const release = resource => {
    // Remote resources may already be disconnected; release the remaining leases anyway.
    try { resource?.[Symbol.dispose]?.(); } catch { /* disconnected RPC resource */ }
  };
  return {
    add(resource, onError) {
      if (!resource) return;
      if (disposed) { release(resource); return; }
      resources.add(resource);
      resource.onRpcBroken?.(onError);
      resource.then?.(lease => {
        if (disposed) release(lease);
        else { resources.add(lease); lease?.onRpcBroken?.(onError); }
      }, onError);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const resource of [...resources].reverse()) release(resource);
      resources.clear();
    },
  };
}

function createNativeUsageSubscription({ onChange, loadService = loadNativeUsageService }) {
  const retryMs = 5000;
  let disposed = false;
  let conversationId = null;
  let usage = null;
  let session = null;
  let retryAt = 0;
  let supported = false;
  const current = candidate => !disposed && session === candidate;
  const clearConnection = candidate => {
    candidate.connection?.dispose(); candidate.connection = null;
    usage = null;
  };
  const fail = candidate => {
    if (!current(candidate)) return;
    session = null; retryAt = Date.now() + retryMs;
    clearConnection(candidate); candidate.resources.dispose(); onChange(candidate.id);
  };
  const connect = async candidate => {
    try {
      const service = await loadService();
      if (!current(candidate)) return;
      if (!service) { fail(candidate); return; }
      supported = true;
      const pending = service.subscribe("local", state => {
        if (!current(candidate)) return;
        clearConnection(candidate);
        if (state.status !== "ready") { onChange(candidate.id); return; }
        const connection = nativeUsageResources(); candidate.connection = connection;
        const active = () => current(candidate) && candidate.connection === connection;
        const onError = () => { if (active()) fail(candidate); };
        try {
          const manager = state.manager.dup(); connection.add(manager, onError);
          const subscription = manager.subscribe({ type: "thread",
            key: { hostId: "local", threadId: candidate.id }, field: "tokenUsageInfo", listener: value => {
              if (!active()) return;
              usage = value; onChange(candidate.id);
            } });
          connection.add(subscription, onError);
        } catch { onError(); }
      });
      candidate.resources.add(pending, () => fail(candidate));
    } catch { fail(candidate); }
  };
  return {
    get supported() { return supported; },
    get(id) { return id === conversationId ? usage : null; },
    select(id) {
      if (disposed) return;
      if (conversationId !== id) {
        const previous = session; session = null; conversationId = id; usage = null; retryAt = 0;
        if (previous) { clearConnection(previous); previous.resources.dispose(); }
      }
      if (!id || session || Date.now() < retryAt) return;
      session = { id, resources: nativeUsageResources(), connection: null };
      void connect(session);
    },
    dispose() {
      disposed = true;
      const previous = session; session = null; usage = null;
      if (previous) { clearConnection(previous); previous.resources.dispose(); }
    },
  };
}
