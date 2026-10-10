// Real CLI integration with a local model fixture: no credentials or model quota required.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectAppServer } from "./fixtures/codex-app-server-client.mjs";
import { guiContextCatalog } from "./fixtures/gui-context-catalog.mjs";

assert.ok(process.argv[2], "Pass the Codex executable path");
const home = await mkdtemp(join(tmpdir(), "gui-conversation-tools-"));
const catalog = join(home, "models.json");
await writeFile(catalog, JSON.stringify(guiContextCatalog(null)));
const tools = JSON.parse(await readFile(new URL(
  "../apps/desktop/src-tauri/src/codex_gui/conversation_tools/tools.json", import.meta.url), "utf8"));
const requests = [];
const calls = [];
const authorizations = [];

function mcp(message, response, authorized) {
  authorizations.push(authorized);
  if (message.id === undefined) { response.writeHead(202).end(); return; }
  let result;
  if (message.method === "initialize") {
    result = { protocolVersion: "2025-03-26", capabilities: { tools: {} },
      serverInfo: { name: "codex_gui", version: "1.0.0" } };
  } else if (message.method === "tools/call") {
    calls.push(message.params);
    result = { content: [{ type: "text", text: JSON.stringify({ conversations: [], total: 0 }) }] };
  } else result = tools;
  response.writeHead(200, { "Content-Type": "application/json" })
    .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
}

function model(body, response) {
  requests.push(body);
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  const id = `response-${requests.length}`;
  const item = calls.length ? { type: "message", id: `message-${requests.length}`, role: "assistant",
    content: [{ type: "output_text", text: "查询完成" }] }
    : { type: "function_call", id: "tool-call", call_id: "call-running", namespace: "mcp__codex_gui",
      name: "gui_list_running_conversations", arguments: "{}" };
  emit({ type: "response.created", response: { id } });
  emit({ type: "response.output_item.added", output_index: 0, item });
  emit({ type: "response.output_item.done", output_index: 0, item });
  emit({ type: "response.completed", response: { id, output: [item],
    usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 } } });
  response.end();
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST") { response.writeHead(405).end(); return; }
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  if (request.url === "/mcp") mcp(body, response, request.headers.authorization === "Bearer fixture");
  else model(body, response);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
await writeFile(join(home, "config.toml"), `model = "gpt-5.4"
model_catalog_json = ${JSON.stringify(catalog.replaceAll("\\", "/"))}
model_provider = "fixture"
approval_policy = "never"
[model_providers.fixture]
name = "fixture"
base_url = "${base}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
`);
// MCP and the normal GUI overrides must all follow app-server, or the CLI drops the root overrides.
const client = connectAppServer({ executable: resolve(process.argv[2]), home, cwd: home, overrides: [
  `mcp_servers.codex_gui.url="${base}/mcp"`,
  'mcp_servers.codex_gui.http_headers={ Authorization = "Bearer fixture" }',
] });
try {
  await client.initialize();
  const { thread } = await client.rpc("thread/start", {
    cwd: home, approvalPolicy: "never", sandbox: "read-only",
  });
  await client.rpc("config/mcpServer/reload");
  for (let index = 0; index < 2; index++) {
    if (index) await client.rpc("thread/resume", { threadId: thread.id, config: {} });
    const { turn } = await client.rpc("turn/start", { threadId: thread.id,
      input: [{ type: "text", text: "查询正在运行的对话", text_elements: [] }] });
    await client.waitFor((event) => event.method === "turn/completed" && event.params.turn.id === turn.id);
  }
  for (const request of requests) {
    for (const tool of tools.tools) {
      assert.ok(JSON.stringify(request.tools).includes(tool.name), `Missing ${tool.name}`);
    }
  }
  assert.ok(requests.length >= 3, "Model did not continue after the tool result");
  assert.deepEqual(calls.map(({ name, arguments: args }) => ({ name, arguments: args })),
    [{ name: "gui_list_running_conversations", arguments: {} }]);
  assert.ok(authorizations.length >= 3 && authorizations.every(Boolean), "MCP authentication missing");
  console.log("PASS: GUI MCP tools reach the model, execute, and survive reload/resume alongside GUI overrides.");
} finally {
  await client.close();
  server.closeAllConnections(); server.close();
}
