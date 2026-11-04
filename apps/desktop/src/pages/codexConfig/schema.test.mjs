import { testText } from '../../../../../scripts/i18n-fixture.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const sourceSchema = JSON.parse(readFileSync(new URL("./schema.generated.json", import.meta.url), "utf8"));
function loadSource(filename, dependencies = {}) {
  const exports = {};
  const source = readFileSync(new URL(filename, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(compiled, { exports, require: (key) => dependencies[key] });
  return exports;
}
const labels = loadSource("./labels.ts", {
  "../../../../../shared/localization/uiText": { uiText: testText },
});
const schema = loadSource("./schema.ts", {
  "./schema.generated.json": { default: sourceSchema }, "./labels": labels,
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const { ConfigArrayWriteQueue } = loadSource("./schemaArrayWriteQueue.ts", { "./schema": schema });

test("custom names matching JavaScript object properties remain ordinary configuration keys", () => {
  assert.equal(labels.fieldLabel("constructor"), "constructor");
  assert.equal(labels.fieldHelp("toString"), undefined);
  assert.equal(labels.optionLabel("__proto__"), "__proto__");
  assert.deepEqual(plain(schema.childSchema({ properties: {} }, "__proto__", false)), { type: "boolean" });
  const updated = schema.replaceNestedValue({ value: {}, path: ["__proto__", "enabled"], replacement: true });
  assert.equal(Object.hasOwn(updated, "__proto__"), true);
  assert.deepEqual(plain(updated), JSON.parse('{"__proto__":{"enabled":true}}'));
});

test("all model, permission, extension and feature schemas resolve to available controls", () => {
  const supported = new Set(["string", "number", "integer", "boolean", "array", "object"]);
  const visited = new Set();
  function visit(input) {
    if (input.$ref) {
      assert.ok(sourceSchema.definitions[input.$ref.split("/").pop()], `Missing ${input.$ref}`);
      if (visited.has(input.$ref)) return;
      visited.add(input.$ref);
    }
    for (const variant of schema.schemaVariants(input)) {
      assert.ok(supported.has(schema.schemaType(variant)), `Unsupported ${JSON.stringify(variant.type)}`);
      Object.values(variant.properties ?? {}).forEach(visit);
      if (variant.items) visit(variant.items);
      if (typeof variant.additionalProperties === "object") visit(variant.additionalProperties);
    }
  }
  visit(sourceSchema);
  Object.values(sourceSchema.definitions).forEach(visit);
  for (const key of Object.keys(sourceSchema.properties)) {
    assert.ok(labels.CONFIG_CATEGORIES.some((category) => category.key === labels.categoryFor(key)));
  }
});

test("union settings recognize the selected detailed approval and hook variant", () => {
  const approvals = schema.schemaVariants(sourceSchema.properties.approval_policy);
  assert.equal(schema.schemaType(approvals[schema.variantIndex(approvals, { granular: {} })]), "object");
  const hooks = schema.schemaVariants(sourceSchema.definitions.HookHandlerConfig);
  assert.equal(schema.variantIndex(hooks, { type: "mcp_tool", server: "demo", tool: "run" }), 1);
  assert.equal(schema.variantIndex(hooks, { type: "prompt" }), 2);
  const exporters = schema.schemaVariants(sourceSchema.definitions.OtelExporterKind);
  assert.equal(schema.variantIndex(exporters, { "otlp-grpc": { endpoint: "https://example.test" } }), 2);
});

test("new named objects include required discriminators without null schema defaults", () => {
  const hooks = schema.schemaVariants(sourceSchema.definitions.HookHandlerConfig);
  assert.deepEqual(plain(schema.initialValue(hooks[1])), { server: "", tool: "", type: "mcp_tool" });
  const history = schema.initialValue(sourceSchema.properties.history);
  assert.deepEqual(plain(history), {});
  const feature = schema.schemaVariants(sourceSchema.properties.features.properties.code_mode);
  assert.equal(schema.schemaType(feature[0]), "boolean");
  assert.equal(schema.schemaType(feature[1]), "object");
});

test("array edits preserve unknown fields and dotted object keys without mutating the source", () => {
  const value = [{ config: { "name.with.dots": "before" }, future_option: false }, { enabled: true }];
  const updated = schema.replaceNestedValue({ value, path: ["0", "config", "name.with.dots"], replacement: "after" });
  assert.deepEqual(plain(updated), [
    { config: { "name.with.dots": "after" }, future_option: false }, { enabled: true },
  ]);
  assert.equal(value[0].config["name.with.dots"], "before");
  assert.deepEqual(plain(schema.replaceNestedValue({ value, path: ["0"], replacement: null })), [{ enabled: true }]);
});

test("search finds translated nested settings and existing unknown fields inside lists", () => {
  assert.equal(schema.matchesSearch({
    key: "profiles", schema: sourceSchema.properties.profiles,
    value: { work: { model_reasoning_effort: "high" } }, query: "思考深度",
  }), true);
  assert.equal(schema.matchesSearch({
    key: "future", schema: {}, value: [{ unknown_switch: false }], query: "unknown_switch",
  }), true);
  assert.equal(schema.matchesSearch({ key: "model", schema: { type: "string" }, query: "找不到的配置" }), false);
});

test("queued edits follow stable rows after deletion and retain the newest prior write", async () => {
  const queue = new ConfigArrayWriteQueue([{ enabled: false }, { name: "second" }]);
  const [first, second] = queue.rows;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const writes = [];
  const save = async (value) => { writes.push(plain(value)); await gate; return true; };
  const remove = queue.edit({ id: first.id, path: [], value: null }, save);
  const rename = queue.edit({ id: second.id, path: ["name"], value: "changed" }, save);
  const add = queue.append(true, save);
  assert.equal(queue.synchronize([{ name: "stale response" }]), false);
  release();
  assert.deepEqual(await Promise.all([remove, rename, add]), [true, true, true]);
  assert.deepEqual(writes, [[{ name: "second" }], [{ name: "changed" }], [{ name: "changed" }, true]]);
  assert.equal(queue.rows[0].id, second.id);
});

test("a rejected array update leaves values intact and permits subsequent edits", async () => {
  const queue = new ConfigArrayWriteQueue(["original"]);
  const id = queue.rows[0].id;
  assert.equal(await queue.edit({ id, path: [], value: "failed" }, async () => false), false);
  assert.equal(await queue.edit({ id, path: [], value: "saved" }, async () => true), true);
  assert.deepEqual(plain(queue.rows.map((row) => row.value)), ["saved"]);
  await assert.rejects(queue.append("rejected", async () => { throw new Error("disk unavailable"); }));
  assert.equal(await queue.append("recovered", async () => true), true);
  assert.deepEqual(plain(queue.rows.map((row) => row.value)), ["saved", "recovered"]);
});
