// Serialize changes only within a conversation. The native client still owns its lifecycle and transport.
class NativeContextAdapter {
  constructor(manager) {
    this.manager = manager;
    this.client = manager.requestClient;
    this.original = this.client.sendRequest;
    this.own = Object.getOwnPropertyDescriptor(this.client, "sendRequest");
    this.threads = new Map();
    this.disposed = false;
    this.activeOperations = 0;
    this.raw = (method, params) => this.original.call(this.client, method, params,
      { timeoutMs: CONTEXT_REQUEST_TIMEOUT });
    this.rejoin = this.rejoin.bind(this);
    this.wrapped = this.request.bind(this);
    this.client.sendRequest = this.wrapped;
    this.originalInterrupt = manager.interruptConversation;
    this.ownInterrupt = Object.getOwnPropertyDescriptor(manager, "interruptConversation");
    if (typeof this.originalInterrupt === "function") {
      this.wrappedInterrupt = (id, mode, expectedTurn) => {
        if (mode === "user-stop") this.thread(id).stops += 1;
        return this.originalInterrupt.call(manager, id, mode, expectedTurn);
      };
      manager.interruptConversation = this.wrappedInterrupt;
    }
  }

  thread(id) {
    if (!this.threads.has(id)) this.threads.set(id, {
      tail: Promise.resolve(), stops: 0, pendingChanges: 0, applied: undefined, previousTurn: {}, reloading: null,
    });
    return this.threads.get(id);
  }

  serial(id, action) {
    const current = this.thread(id);
    this.activeOperations += 1;
    const pending = current.tail.then(action).finally(() => {
      this.activeOperations -= 1;
      if (this.disposed && this.activeOperations === 0) this.restore();
    });
    current.tail = pending.catch(() => {}); // Caller handles failure; subsequent requests must still work.
    return pending;
  }

  async rejoin(snapshot, capacity) {
    const id = snapshot.thread.id;
    const current = this.thread(id);
    current.reloading = { snapshot, capacity, resumed: false };
    try {
      // Rebuild native instructions, tools and environment before adding the capacity override.
      this.manager.updateConversationState(id, conversation => { conversation.resumeState = "needs_resume"; });
      const result = await this.manager.resumeConversation({ conversationId: id, model: snapshot.model,
        reasoningEffort: snapshot.reasoningEffort, serviceTier: snapshot.serviceTier,
        workspaceRoots: snapshot.runtimeWorkspaceRoots ?? [snapshot.cwd],
        collaborationMode: snapshot.collaborationMode ?? null });
      if (result.status !== "ready" || !current.reloading.resumed) throw new Error("resume-failed");
    } finally { current.reloading = null; }
  }

  async resumePending(params, options, pending) {
    const preserved = contextResumeParams(params.threadId, pending.snapshot);
    delete preserved.excludeTurns;
    const config = { ...params.config, ...preserved.config };
    if (pending.capacity !== null) config.model_context_window = pending.capacity;
    const result = await this.original.call(this.client, "thread/resume", { ...params, ...preserved, config }, options);
    pending.resumed = true;
    return result;
  }

  request(method, params, options) {
    const id = params?.threadId;
    const current = this.threads.get(id);
    if (method === "thread/resume" && current?.reloading) return this.resumePending(params, options, current.reloading);
    if (this.disposed || !id || !["thread/resume", "turn/start", "turn/interrupt"].includes(method)) {
      return this.original.call(this.client, method, params, options);
    }
    if (method === "turn/interrupt") {
      this.thread(id).stops += 1;
      if (!current?.pendingChanges) return this.original.call(this.client, method, params, options);
    }
    return this.serial(id, () => this.requestForThread(method, params, options));
  }

  async requestForThread(method, params, options) {
    const id = params.threadId;
    if (method === "turn/interrupt") return contextManualStop({ raw: this.raw, id, params });
    const current = this.thread(id);
    const capacity = readContextCapacity(id);
    if (method === "thread/resume") {
      const result = await this.original.call(this.client, method, capacity === null ? params
        : { ...params, config: { ...params.config, model_context_window: capacity } }, options);
      // An already loaded thread may ignore config. Confirm by reloading before its next turn.
      if (capacity === null) current.applied = capacity;
      return result;
    }
    if (capacity !== null && current.applied !== capacity) {
      await reloadContextCapacity({ raw: this.raw, rejoin: this.rejoin, id, capacity, previous: null });
      current.applied = capacity;
    }
    current.previousTurn = contextContinuationOverrides(params);
    return this.original.call(this.client, method, params, options);
  }

  read(id) { return readContextCapacity(id); }

  save(id, capacity) {
    const current = this.thread(id);
    current.pendingChanges += 1;
    return this.serial(id, () => {
      if (!this.manager.getConversation(id) || (capacity !== null
        && parseContextCapacity(String(capacity / TOKENS_PER_K)) !== capacity)) throw new Error("invalid-capacity");
      return changeContextCapacity({ raw: this.raw, rejoin: this.rejoin, id, capacity,
        current, isDisposed: () => this.disposed });
    }).finally(() => { current.pendingChanges -= 1; });
  }

  dispose() {
    this.disposed = true;
    // Finish an acknowledged save or rollback before removing its native resume hook.
    if (this.activeOperations === 0) this.restore();
  }

  restore() {
    if (this.client.sendRequest === this.wrapped) {
      if (this.own) Object.defineProperty(this.client, "sendRequest", this.own);
      else delete this.client.sendRequest;
    }
    if (this.wrappedInterrupt && this.manager.interruptConversation === this.wrappedInterrupt) {
      if (this.ownInterrupt) Object.defineProperty(this.manager, "interruptConversation", this.ownInterrupt);
      else delete this.manager.interruptConversation;
    }
  }
}

function createContextAdapter(manager) { return new NativeContextAdapter(manager); }
