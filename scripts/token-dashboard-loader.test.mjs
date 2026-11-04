import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL(
  "../shared/token-usage/dashboardLoader.ts", import.meta.url,
), "utf8");
const exports = {};
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports });
const { createDashboardLoader } = exports;

function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

test("polling skips ticks while the previous request remains active", async () => {
  const run = createDashboardLoader();
  const request = deferred();
  let started = 0;
  const task = async () => { started += 1; await request.promise; };
  const first = run(task);
  await Promise.all([run(task), run(task), run(task)]);
  assert.equal(started, 1);
  request.resolve();
  await first;
  await run(task);
  assert.equal(started, 2);
});

test("changing range during refresh runs only the newest range when the pending request completes", async () => {
  const run = createDashboardLoader();
  const request = deferred();
  const ranges = [];
  const first = run(async () => { ranges.push(20); await request.promise; });
  await run(async () => { ranges.push(10); }, true);
  await run(async () => { ranges.push(5); }, true);
  await run(async () => { ranges.push(99); });
  assert.deepEqual(ranges, [20]);
  request.resolve();
  await first;
  assert.deepEqual(ranges, [20, 5]);
});

test("a cancelled view does not start its queued request", async () => {
  const run = createDashboardLoader();
  const request = deferred();
  let mounted = true;
  let requests = 0;
  const first = run(() => request.promise);
  await run(async () => { if (mounted) requests += 1; }, true);
  mounted = false;
  request.resolve();
  await first;
  assert.equal(requests, 0);
});

test("a failed refresh releases the flight and permits the newest queued range", async () => {
  const run = createDashboardLoader();
  const request = deferred();
  let refreshed = false;
  const first = run(async () => { await request.promise; throw new Error("offline"); });
  await run(async () => { refreshed = true; }, true);
  request.resolve();
  await assert.rejects(first, /offline/);
  assert.equal(refreshed, true);
  await run(async () => { refreshed = false; });
  assert.equal(refreshed, false);
});
