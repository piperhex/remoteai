import assert from "node:assert/strict";
import test from "node:test";
import { createRuntime } from "./fixtures/context-settings-runtime.mjs";
import { parseContextCapacity, CONTEXT_CAPACITY_PRESETS_K } from "../shared/context-usage/settings.js";

test("uses the GUI capacity range, precision, presets and default", () => {
  assert.deepEqual(CONTEXT_CAPACITY_PRESETS_K, [128, 272, 384, 400, 1000]);
  for (const [input, value] of [["", null], ["1", 1000], ["258.401", 258401], ["100000", 100000000]]) {
    assert.equal(parseContextCapacity(input), value);
  }
  for (const input of ["0", "1e3", "100001", "1.0001", "-1", "NaN"]) {
    assert.equal(parseContextCapacity(input), undefined);
  }
});

test("applies and resets capacity only for the selected idle thread, preserving its permissions", async () => {
  const runtime = createRuntime();
  assert.equal(await runtime.adapter.save("one", 384000), "applied");
  assert.equal(runtime.capacities.get("one"), 384000);
  assert.equal(runtime.adapter.read("one"), 384000);
  assert.equal(runtime.adapter.read("two"), null);
  assert.ok(runtime.calls.every(call => call.params.threadId === "one"));
  assert.equal(runtime.calls.filter(call => call.method === "turn/start").length, 0);
  const permissions = runtime.calls.find(call => call.method === "thread/settings/update");
  assert.equal(permissions.params.sandboxPolicy.networkAccess, false);
  const reload = runtime.calls.find(call => call.method === "thread/resume" && call.params.config);
  assert.equal(reload.params.config["features.desktop_tools"], true);
  assert.equal(reload.params.developerInstructions, "native desktop instructions");
  assert.equal(await runtime.adapter.save("one", null), "applied");
  assert.equal(runtime.adapter.read("one"), null);
  assert.equal(runtime.capacities.get("one"), null);
});

test("pauses an active reply before reloading and continues without replaying user input", async () => {
  const runtime = createRuntime();
  await runtime.manager.requestClient.sendRequest("turn/start", { threadId: "one",
    input: [{ text: "perform a payment" }], outputSchema: { type: "object" } });
  assert.equal(await runtime.adapter.save("one", 400000), "continued");
  const methods = runtime.calls.map(call => call.method);
  assert.ok(methods.indexOf("turn/interrupt") < methods.indexOf("thread/unsubscribe"));
  const continuation = runtime.calls.filter(call => call.method === "turn/start").at(-1).params;
  assert.equal(continuation.input[0].text, "请继续完成刚才中断的任务。");
  assert.equal(continuation.outputSchema.type, "object");
  assert.equal(continuation.approvalPolicy, "on-request");
});

test("honors a manual stop while saving and serializes competing operations for that thread", async () => {
  let release;
  const pause = new Promise(resolve => { release = resolve; });
  let reached;
  const pending = new Promise(resolve => { reached = resolve; });
  const runtime = createRuntime({ active: true, delay: async method => {
    if (method === "thread/unsubscribe") { reached(); await pause; }
  } });
  const saving = runtime.adapter.save("one", 272000);
  await pending;
  const stop = runtime.manager.requestClient.sendRequest("turn/interrupt", { threadId: "one", turnId: "old" });
  await runtime.manager.requestClient.sendRequest("thread/resume", { threadId: "two" });
  release();
  assert.equal(await saving, "paused");
  await stop;
  assert.equal(runtime.calls.filter(call => call.method === "turn/start").length, 0);
});

test("restores old capacity after apply or persistence failure, and reports continuation failure", async () => {
  for (const options of [
    { fail: (method, params) => method === "thread/resume" && params.config?.model_context_window === 384000 },
    { storageFailure: true },
  ]) {
    const runtime = createRuntime(options);
    await assert.rejects(runtime.adapter.save("one", 384000));
    assert.equal(runtime.adapter.read("one"), null);
    assert.equal(runtime.capacities.get("one"), null);
  }
  const runtime = createRuntime({ active: true, fail: method => method === "turn/start" });
  assert.equal(await runtime.adapter.save("one", 384000), "resumeFailed");
  assert.equal(runtime.adapter.read("one"), 384000);
});

test("reapplies saved settings on native resume and restores the original transport on disposal", async () => {
  const runtime = createRuntime();
  await runtime.adapter.save("one", 384000);
  await runtime.manager.requestClient.sendRequest("thread/resume", { threadId: "one", config: { other: true } });
  assert.equal(runtime.calls.at(-1).params.config.model_context_window, 384000);
  assert.equal(runtime.calls.at(-1).params.config.other, true);
  runtime.adapter.dispose();
  assert.equal(runtime.manager.requestClient.sendRequest, runtime.request);
  await assert.rejects(runtime.adapter.save("one", 272000));
});

test("leaves ordinary native interrupts untouched and honors user-stop after the reply has become idle", async () => {
  let release;
  let reached;
  const pause = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  const runtime = createRuntime({ active: true, delay: async method => {
    if (method === "thread/unsubscribe") { reached(); await pause; }
  } });
  await runtime.manager.requestClient.sendRequest("turn/interrupt", { threadId: "two", turnId: "native-turn" });
  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0].params.turnId, "native-turn");
  const saving = runtime.adapter.save("one", 384000);
  await waiting;
  await runtime.manager.interruptConversation("one", "user-stop");
  release();
  assert.equal(await saving, "paused");
  assert.equal(runtime.calls.filter(call => call.method === "turn/start").length, 0);
});

test("finishes an in-flight reload on disposal, without resuming the paused reply", async () => {
  let release;
  let reached;
  const pause = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  const runtime = createRuntime({ active: true, delay: async method => {
    if (method === "thread/unsubscribe") { reached(); await pause; }
  } });
  const saving = runtime.adapter.save("one", 384000);
  await waiting;
  runtime.adapter.dispose();
  release();
  assert.equal(await saving, "paused");
  assert.equal(runtime.adapter.read("one"), 384000);
  assert.equal(runtime.manager.requestClient.sendRequest, runtime.request);
});
