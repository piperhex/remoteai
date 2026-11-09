// Verify interruption, capacity reload and continuation on the installed CLI without model credits.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { guiContextCatalog } from "./fixtures/gui-context-catalog.mjs";

assert.ok(process.argv[2], "Pass the Codex executable path");
const root = await mkdtemp(join(tmpdir(), "gui-live-model-"));
const home = join(root, "home");
await mkdir(home);
const catalog = join(home, "models.json");
await writeFile(catalog, JSON.stringify(guiContextCatalog(null)));
const bodies = [];
let releaseBackground;
let backgroundReceived;
const backgroundReady = new Promise((resolve) => { backgroundReceived = resolve; });
const server = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    bodies.push(JSON.parse(raw));
    const count = bodies.length;
    const respond = () => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
    const item = count === 1
      ? { type: "function_call", id: "tool-1", call_id: "call-1", name: "fixture_wait", arguments: "{}" }
      : { type: "message", id: `message-${count}`, role: "assistant",
        content: [{ type: "output_text", text: "completed" }] };
    emit({ type: "response.created", response: { id: `response-${count}` } });
    emit({ type: "response.output_item.added", output_index: 0, item });
    emit({ type: "response.output_item.done", output_index: 0, item });
    emit({ type: "response.completed", response: { id: `response-${count}`, output: [item],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
    response.end();
    };
    if (raw.includes("hold-background")) {
      releaseBackground = respond;
      backgroundReceived();
    } else respond();
  });
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
await writeFile(join(home, "config.toml"), `model = "gpt-5.4"
model_context_window = 200000
thread_unload_delay_secs = 0
model_catalog_json = ${JSON.stringify(catalog.replaceAll("\\", "/"))}
model_provider = "fixture"
approval_policy = "never"
[model_providers.fixture]
name = "fixture"
base_url = "http://127.0.0.1:${server.address().port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
`);
const child = spawn(resolve(process.argv[2]), ["app-server", "-c", "features.step_model_switching=true"], {
  cwd: root, env: { ...process.env, CODEX_HOME: home }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
});
const pending = new Map();
const events = [];
let sequence = 0;
let stderr = "";
child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  const value = JSON.parse(line);
  if (value.method) events.push(value);
  else {
    const call = pending.get(value.id);
    if (!call) return;
    pending.delete(value.id);
    clearTimeout(call.timer);
    if (value.error) call.reject(new Error(JSON.stringify(value.error)));
    else call.resolve(value.result);
  }
});
const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => reject(new Error(`Timed out: ${method}\n${stderr}`)), 20000);
  pending.set(id, { resolve, reject, timer });
  send({ id, method, params });
});
async function waitFor(predicate) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Event timed out: ${JSON.stringify(events).slice(-3000)}\n${stderr}`);
}
try {
  await rpc("initialize", { clientInfo: { name: "gui-live-fixture", version: "1.0.0" },
    capabilities: { experimentalApi: true } });
  send({ method: "initialized" });
  const { thread } = await rpc("thread/start", { model: "gpt-5.4", cwd: root,
    dynamicTools: [{ type: "function", name: "fixture_wait", description: "Wait for fixture",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } }] });
  const { turn } = await rpc("turn/start", { threadId: thread.id, model: "gpt-5.4", effort: "low",
    input: [{ type: "text", text: "Call fixture_wait, then finish." }] });
  const tool = await waitFor((event) => event.method === "item/tool/call");
  assert.equal(bodies.length, 1);
  const { thread: background } = await rpc("thread/start", { model: "gpt-5.4", cwd: root });
  const { turn: backgroundTurn } = await rpc("turn/start", { threadId: background.id,
    input: [{ type: "text", text: "hold-background" }] });
  await backgroundReady;
  const snapshot = await rpc("thread/resume", { threadId: thread.id, excludeTurns: true });
  assert.equal(snapshot.thread.status.type, "active");
  // Poll metadata while the request is waiting on a tool; the app server must stay responsive.
  for (let index = 0; index < 3; index++) {
    const read = await rpc("thread/read", { threadId: thread.id, includeTurns: false });
    assert.equal(read.thread.status.type, "active");
  }
  await rpc("turn/interrupt", { threadId: thread.id, turnId: turn.id });
  const paused = await waitFor((event) => event.method === "turn/completed" && event.params.turn.id === turn.id);
  assert.equal(paused.params.turn.status, "interrupted");
  const rejoin = async (capacity) => {
    const previousEvents = events.length;
    assert.equal((await rpc("thread/unsubscribe", { threadId: thread.id })).status, "unsubscribed");
    await waitFor((event) => event.method === "thread/closed" && event.params.threadId === thread.id
      && events.indexOf(event) >= previousEvents);
    const params = { threadId: thread.id, excludeTurns: true, model: snapshot.model,
      modelProvider: snapshot.modelProvider, cwd: snapshot.cwd, approvalPolicy: snapshot.approvalPolicy,
      approvalsReviewer: snapshot.approvalsReviewer, serviceTier: snapshot.serviceTier,
      config: capacity === null ? {} : { model_context_window: capacity } };
    if (snapshot.activePermissionProfile) params.permissions = snapshot.activePermissionProfile.id;
    else params.sandbox = "read-only";
    const resumed = await rpc("thread/resume", params);
    assert.equal(resumed.thread.id, thread.id);
    assert.equal(resumed.model, snapshot.model);
    assert.deepEqual(resumed.activePermissionProfile, snapshot.activePermissionProfile);
  };
  await rejoin(384000);
  const continueTask = async () => {
    const result = await rpc("turn/start", { threadId: thread.id,
      input: [{ type: "text", text: "请继续完成刚才中断的任务。" }] });
    await waitFor((event) => event.method === "turn/completed" && event.params.turn.id === result.turn.id);
    return events.filter((event) => event.method === "thread/tokenUsage/updated").at(-1)
      .params.tokenUsage.modelContextWindow;
  };
  assert.equal(await continueTask(), 364800);
  assert.equal(bodies.length, 3);
  assert.equal(bodies[2].model, "gpt-5.4");
  const history = await rpc("thread/read", { threadId: thread.id, includeTurns: true });
  assert.equal(history.thread.turns[0].id, turn.id);
  assert.equal(history.thread.turns[0].status, "interrupted");
  assert.equal(history.thread.turns.at(-1).status, "completed");
  assert.equal((await rpc("thread/read", { threadId: background.id })).thread.status.type, "active");
  releaseBackground();
  await waitFor((event) => event.method === "turn/completed" && event.params.turn.id === backgroundTurn.id);
  const backgroundUsage = events.filter((event) => event.method === "thread/tokenUsage/updated"
    && event.params.threadId === background.id).at(-1);
  assert.equal(backgroundUsage.params.tokenUsage.modelContextWindow, 190000);
  await rejoin(null);
  assert.equal(await continueTask(), 190000);
  console.log("PASS: pause during tool execution, reload 384K, continue with 364.8K; history retained; concurrent request unaffected; reset 190K.");

} finally {
  for (const call of pending.values()) clearTimeout(call.timer);
  lines.close();
  child.kill();
  server.closeAllConnections();
  server.close();
}
