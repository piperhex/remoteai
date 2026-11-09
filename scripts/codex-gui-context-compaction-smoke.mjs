// Receives overrides produced by the real GUI Rust code or native window adapter.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectAppServer } from "./fixtures/codex-app-server-client.mjs";
import { guiContextCatalog } from "./fixtures/gui-context-catalog.mjs";
import { contextUsage } from "../shared/context-usage/values.js";

assert.ok(process.argv[2] && process.argv[3], "Pass the Codex binary and generated context configurations");
const executable = resolve(process.argv[2]);
const configurations = JSON.parse(process.argv[3]);
const REPORTED_USAGE = 285_000;
const STALE_LIMIT = 250_000;

function fixture() {
  let nextUsage = 15;
  let failNext = false;
  let sequence = 0;
  const server = createServer(async (request, response) => {
    request.resume();
    await once(request, "end");
    if (failNext) {
      failNext = false;
      response.writeHead(429, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { type: "insufficient_quota", code: "insufficient_quota",
        message: "Fixture account quota exhausted" } }));
      return;
    }
    const id = `fixture-${++sequence}`;
    const item = { type: "message", id, role: "assistant",
      content: [{ type: "output_text", text: "OK" }] };
    const usage = { input_tokens: nextUsage - 5, output_tokens: 5, total_tokens: nextUsage };
    nextUsage = 15;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
    emit({ type: "response.created", response: { id } });
    emit({ type: "response.output_item.added", output_index: 0, item });
    emit({ type: "response.output_item.done", output_index: 0, item });
    emit({ type: "response.completed", response: { id, output: [item], usage } });
    response.end();
  });
  return { server, reportUsage(value) { nextUsage = value; }, failNext() { failNext = true; } };
}

async function turn(client, threadId, expectedStatus = "completed") {
  const { turn } = await client.rpc("turn/start", {
    threadId, input: [{ type: "text", text: "Reply OK without using tools." }],
  });
  const event = await client.waitFor((event) => event.method === "turn/completed"
    && event.params.turn.id === turn.id);
  assert.equal(event.params.turn.status, expectedStatus, JSON.stringify(event));
  return event.params.turn;
}

async function rejoin(client, threadId, config) {
  const previousEvents = client.events.length;
  assert.equal((await client.rpc("thread/unsubscribe", { threadId })).status, "unsubscribed");
  if (configurations.unloadConfig) {
    await client.waitFor((event) => event.method === "thread/closed" && event.params.threadId === threadId
      && client.events.indexOf(event) >= previousEvents);
  }
  await client.rpc("thread/resume", { threadId, sandbox: "read-only", config });
}

async function checkUsage({ client, threadId, provider, used = REPORTED_USAGE, capacity, compact }) {
  client.events.length = 0;
  provider.reportUsage(used);
  const completed = await turn(client, threadId);
  const usage = client.events.findLast((event) => event.method === "thread/tokenUsage/updated"
    && event.params.threadId === threadId && event.params.turnId === completed.id
    && event.params.tokenUsage.last.totalTokens === used)?.params.tokenUsage;
  assert.ok(usage, "Missing reported usage");
  assert.deepEqual(contextUsage(usage), { used, capacity, percent: Math.min(100, Math.round(used / capacity * 100)) });
  await turn(client, threadId);
  const compacted = client.events.some((event) => event.method === "item/completed"
    && event.params.item.type === "contextCompaction");
  assert.equal(compacted, compact, `Unexpected compaction at ${used} / ${capacity}`);
}

async function configure({ home, port, source }) {
  const catalogPath = join(home, "models.json");
  const catalog = guiContextCatalog(null);
  if (source === "catalog") catalog.models[0].auto_compact_token_limit = STALE_LIMIT;
  await writeFile(catalogPath, JSON.stringify(catalog));
  await writeFile(join(home, "config.toml"), `model = "gpt-5.4"
model_context_window = 272000
model_provider = "codex-switch-gui"
model_catalog_json = ${JSON.stringify(catalogPath.replaceAll("\\", "/"))}
approval_policy = "never"
${source === "config" ? `model_auto_compact_token_limit = ${STALE_LIMIT}` : ""}
[model_providers.codex-switch-gui]
name = "Codex GUI"
base_url = "http://127.0.0.1:${port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
`);
}

async function checkChanges({ client, threadId, provider }) {
  const check = (options) => checkUsage({ client, threadId, provider, ...options });
  // Baseline reproduces the previous GUI request: 30% still triggers compaction.
  await check({ capacity: 950_000, compact: true });
  await rejoin(client, threadId, configurations.large);
  await check({ capacity: 950_000, compact: false });
  // The new limit must still compact near capacity instead of disabling compaction.
  await check({ used: 905_000, capacity: 950_000, compact: true });
  await rejoin(client, threadId, configurations.small);
  await check({ capacity: 380_000, compact: false });
  await check({ used: 365_000, capacity: 380_000, compact: true });
  await rejoin(client, threadId, configurations.default);
  await check({ capacity: 258_400, compact: true });
  const { thread } = await client.rpc("thread/start", { sandbox: "read-only", config: configurations.large });
  await checkUsage({ client, threadId: thread.id, provider, capacity: 950_000, compact: false });
  const { thread: other } = await client.rpc("thread/start", { sandbox: "read-only" });
  await checkUsage({ client, threadId: other.id, provider, capacity: 258_400, compact: true });
  await rejoin(client, threadId, configurations.large);
}

async function checkIdleReload({ client, threadId, provider }) {
  const used = 264_600;
  const check = (options) => checkUsage({ client, threadId, provider, used, ...options });
  await rejoin(client, threadId, configurations.small);
  await check({ capacity: 380_000, compact: false });
  // An empty config forces a fresh load, reproducing the expired engine grace period without
  // waiting thirty minutes. Model discovery then sees a thread loaded with global defaults.
  await rejoin(client, threadId, {});
  await client.rpc("thread/resume", { threadId, excludeTurns: true });
  // Config on another resume of an already subscribed thread cannot repair the lost override.
  await client.rpc("thread/resume", { threadId, config: configurations.small });
  await check({ capacity: 258_400, compact: true });
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await rejoin(client, threadId, {});
    await client.rpc("thread/resume", { threadId, excludeTurns: true });
    // Rust supplies the decision from the same capacity cache used by the GUI request path.
    if (configurations.reapplyAfterRelease ?? true) await rejoin(client, threadId, configurations.small);
    await check({ capacity: 380_000, compact: false });
  }
  await checkUsage({ client, threadId, provider, used: 365_000, capacity: 380_000, compact: true });
  await rejoin(client, threadId, configurations.large);
}

async function checkSystemErrorReload({ client, threadId, provider }) {
  provider.failNext();
  const failed = await turn(client, threadId, "failed");
  const snapshot = await client.rpc("thread/resume", { threadId, excludeTurns: true });
  assert.equal(snapshot.thread.status.type, "systemError");
  // Rust supplies the same classification used by capacity reload and its interruption guard.
  assert.equal(configurations.reapplyAfterSystemError, true,
    "A stopped systemError thread must be reloadable");
  await rejoin(client, threadId, configurations.small);
  await checkUsage({ client, threadId, provider, capacity: 380_000, compact: false });
  const history = await client.rpc("thread/read", { threadId, includeTurns: true });
  assert.equal(history.thread.turns.find((entry) => entry.id === failed.id)?.status, "failed");
  assert.equal(history.thread.turns.at(-1).status, "completed");
  await rejoin(client, threadId, configurations.large);
}

async function exercise(source) {
  const root = await mkdtemp(join(tmpdir(), "gui-context-compaction-"));
  const home = join(root, "home");
  await mkdir(home);
  const provider = fixture();
  provider.server.listen(0, "127.0.0.1");
  await once(provider.server, "listening");
  await configure({ home, port: provider.server.address().port, source });
  const connect = () => connectAppServer({ executable, home, cwd: root,
    overrides: configurations.unloadConfig ? [configurations.unloadConfig] : [] });
  let client = connect();
  try {
    await client.initialize();
    const { thread } = await client.rpc("thread/start", { cwd: root, sandbox: "read-only",
      config: { model_context_window: 1_000_000 } });
    await checkChanges({ client, threadId: thread.id, provider });
    if (configurations.reapplyAfterSystemError !== undefined) {
      await checkSystemErrorReload({ client, threadId: thread.id, provider });
    }
    await checkIdleReload({ client, threadId: thread.id, provider });
    await client.close();
    client = connect();
    await client.initialize();
    await client.rpc("thread/resume", { threadId: thread.id, sandbox: "read-only", config: configurations.large });
    await checkUsage({ client, threadId: thread.id, provider, capacity: 950_000, compact: false });
    const recovery = configurations.reapplyAfterSystemError === undefined ? "" : "429 systemError recovery, ";
    console.log(`PASS ${source}: 1M/400K thresholds, ${recovery}idle reload, other threads, restart`);
  } finally {
    await client.close();
    provider.server.closeAllConnections();
    await new Promise((done) => provider.server.close(done));
  }
}

await exercise("config");
await exercise("catalog");
