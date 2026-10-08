// Exercise native CLI discovery through a local GUI-style proxy without credentials or model credits.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { connectAppServer } from "./fixtures/codex-app-server-client.mjs";

assert.ok(process.argv[2], "Pass the Codex executable path");
const executable = resolve(process.argv[2]);
const home = await mkdtemp(join(tmpdir(), "gui-model-catalog-"));
const { stdout } = await promisify(execFile)(executable, ["debug", "models", "--bundled"], {
  windowsHide: true, maxBuffer: 16 * 1024 * 1024,
});
const template = JSON.parse(stdout).models.find((model) => model.visibility === "list");
const discovered = { ...template, slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol",
  visibility: "list", supported_in_api: true };
let models = [discovered, { ...discovered, slug: "fixture-hidden", visibility: "hide" }];
const requests = [];
const server = createServer((request, response) => {
  requests.push({ url: request.url, authorization: request.headers.authorization });
  // Match the GUI proxy: an empty upstream catalog is a failed refresh, never a cache replacement.
  response.writeHead(models.length ? 200 : 502, { "Content-Type": "application/json" });
  response.end(JSON.stringify(models.length ? { models } : { error: { message: "Model catalog unavailable" } }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}/codex-gui/v1`;
await writeFile(join(home, "config.toml"), `model_provider = "codex-switch-gui"
cli_auth_credentials_store = "file"
[features]
api_key_model_discovery = true
[model_providers.codex-switch-gui]
name = "Codex GUI"
base_url = "${baseUrl}"
model_catalog_url = "${baseUrl}/models"
wire_api = "responses"
requires_openai_auth = false
experimental_bearer_token = "fixture-token"
supports_websockets = false
`);
const client = connectAppServer({ executable, home, cwd: home });
try {
  await client.initialize();
  const initial = await client.rpc("model/list", { limit: 100 });
  assert.deepEqual(initial.data.map((model) => model.model), ["gpt-6.1-sol"]);
  assert.ok(requests.length > 0, "The CLI must fetch the proxy's model catalog");
  assert.ok(requests.every((request) => request.url.startsWith("/codex-gui/v1/models?client_version=")));
  assert.ok(requests.every((request) => request.authorization === "Bearer fixture-token"));
  models = [discovered, { ...discovered, slug: "fixture-new-model" }];
  const cachePath = join(home, "models_cache.json");
  const cache = JSON.parse(await readFile(cachePath, "utf8"));
  await writeFile(cachePath, JSON.stringify({ ...cache, fetched_at: "2000-01-01T00:00:00Z" }));
  const refreshed = await client.rpc("model/list", { limit: 100 });
  assert.deepEqual(refreshed.data.map((model) => model.model), ["gpt-6.1-sol", "fixture-new-model"]);
  const successful = JSON.parse(await readFile(cachePath, "utf8"));
  const expired = JSON.stringify({ ...successful, fetched_at: "2000-01-01T00:00:00Z" });
  await writeFile(cachePath, expired);
  models = [];
  const beforeEmpty = requests.length;
  // This CLI can still return [] on failure; the UI protects its own last successful snapshot separately.
  await client.rpc("model/list", { limit: 100 });
  assert.ok(requests.length > beforeEmpty, "An expired catalog must attempt a refresh");
  assert.equal(await readFile(cachePath, "utf8"), expired, "Failed refreshes must preserve the nonempty disk cache");
  models = [{ ...discovered, slug: "fixture-new-account" }];
  await unlink(cachePath);
  const switched = await client.rpc("model/list", { limit: 100 });
  assert.deepEqual(switched.data.map((model) => model.model), ["fixture-new-account"]);
  console.log("PASS: discovery, empty-response protection, cache expiry and account changes without CLI restart.");
} finally {
  await client.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
