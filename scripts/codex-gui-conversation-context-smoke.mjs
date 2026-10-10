// Verify the installed CLI preserves separate context inputs in events and persisted history.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectAppServer } from "./fixtures/codex-app-server-client.mjs";
import { guiContextCatalog } from "./fixtures/gui-context-catalog.mjs";

assert.ok(process.argv[2], "Pass the Codex executable path");
const root = await mkdtemp(join(tmpdir(), "gui-conversation-context-"));
const home = join(root, "home");
await mkdir(home);
const catalog = join(home, "models.json");
await writeFile(catalog, JSON.stringify(guiContextCatalog(null)));
const requests = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    requests.push(JSON.parse(body));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
    const item = { type: "message", id: `message-${requests.length}`, role: "assistant",
      content: [{ type: "output_text", text: "参考方案已收到" }] };
    emit({ type: "response.created", response: { id: `response-${requests.length}` } });
    emit({ type: "response.output_item.added", output_index: 0, item });
    emit({ type: "response.output_item.done", output_index: 0, item });
    emit({ type: "response.completed", response: { id: `response-${requests.length}`, output: [item],
      usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 } } });
    response.end();
  });
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
await writeFile(join(home, "config.toml"), `model = "gpt-5.4"
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
const client = connectAppServer({ executable: resolve(process.argv[2]), home, cwd: root });
const text = (value) => ({ type: "text", text: value, text_elements: [] });
const context = (value) => text(`<codex_gui_conversation_context>\n${JSON.stringify(value)}
</codex_gui_conversation_context>`);
try {
  await client.initialize();
  const { thread } = await client.rpc("thread/start", { cwd: root, approvalPolicy: "never", sandbox: "read-only" });
  const input = [text("参考这个对话的方案"), context({ kind: "reference", id: "source", name: "设计方案",
    messages: [{ role: "user", text: "使用蓝色按钮" }, { role: "assistant", text: "确定使用蓝色" }],
    truncated: false, note: "仅供参考，以当前用户消息为准。" })];
  const { turn } = await client.rpc("turn/start", { threadId: thread.id, input });
  await client.waitFor((event) => event.method === "turn/completed" && event.params.turn.id === turn.id);
  const event = client.events.find((event) => event.method === "item/completed"
    && event.params.item.type === "userMessage");
  assert.ok(event, "User message completion event missing");
  assert.deepEqual(event.params.item.content.map((part) => part.text), input.map((part) => part.text));
  const history = await client.rpc("thread/read", { threadId: thread.id, includeTurns: true });
  const user = history.thread.turns.flatMap((turn) => turn.items).find((item) => item.type === "userMessage");
  assert.deepEqual(user.content.map((part) => part.text), input.map((part) => part.text));
  // The CLI concatenates text inputs in previews; the host must remove generated context there too.
  assert.ok(history.thread.preview.startsWith("参考这个对话的方案"));
  assert.ok(history.thread.preview.includes("<codex_gui_conversation_context>"));
  const modelInput = JSON.stringify(requests[0].input);
  assert.ok(modelInput.includes("使用蓝色按钮"));
  assert.ok(!modelInput.includes('"kind":"awareness"'));
  console.log("PASS: CLI forwards conversation snapshots and preserves context boundaries in events and history.");
} finally {
  await client.close();
  server.closeAllConnections(); server.close();
}
