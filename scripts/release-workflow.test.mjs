import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const scriptStart = workflow.indexOf("script: |") + "script: |".length;
const script = workflow.slice(scriptStart, workflow.indexOf("\n  release:", scriptStart));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const createRelease = new AsyncFunction("github", "context", "core", "process", script);
const TAG = "v1.2.3";
const NAME = `Remote AI ${TAG}`;

function fixture(releases = []) {
  const calls = [];
  const outputs = {};
  const repos = {
    listReleases() {},
    async createRelease(input) { calls.push(["create", input]); return { data: { id: 42 } }; },
    async updateRelease(input) { calls.push(["update", input]); },
    async generateReleaseNotes() { return { data: { body: "Generated notes" } }; },
  };
  const github = {
    rest: { repos },
    async paginate(method, input) {
      assert.equal(method, repos.listReleases);
      assert.deepEqual(input, { owner: "owner", repo: "repo", per_page: 100 });
      return releases;
    },
  };
  const core = { info() {}, setOutput(name, value) { outputs[name] = value; } };
  const process = { env: { TAG_NAME: TAG, RELEASE_NAME: NAME, PRERELEASE: "false" } };
  return {
    calls, outputs, github,
    run: () => createRelease(github, { repo: { owner: "owner", repo: "repo" } }, core, process),
  };
}

test("reuses a matching draft without replacing its notes or uploaded assets", async () => {
  const draft = { id: 7, tag_name: TAG, name: NAME, body: "Reviewed notes", draft: true };
  const run = fixture([{ ...draft, id: 6, tag_name: "v1.2.2" }, draft]);
  assert.equal(await run.run(), "7");
  assert.equal(run.outputs.release_draft, "true");
  assert.deepEqual(run.calls, []);
});

test("preserves published release state when rebuilding its artifacts", async () => {
  const run = fixture([{ id: 8, tag_name: TAG, name: NAME, body: "Reviewed notes", draft: false }]);
  assert.equal(await run.run(), "8");
  assert.equal(run.outputs.release_draft, "false");
  assert.deepEqual(run.calls, []);
});

test("creates one draft only when no matching release exists", async () => {
  const run = fixture();
  assert.equal(await run.run(), "42");
  assert.equal(run.outputs.release_draft, "true");
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0][0], "create");
  assert.equal(run.calls[0][1].tag_name, TAG);
  assert.equal(run.calls[0][1].draft, true);
});

test("a failed release lookup does not create a duplicate draft", async () => {
  const run = fixture();
  run.github.paginate = async () => { throw new Error("Release lookup failed"); };
  await assert.rejects(run.run(), /Release lookup failed/);
  assert.deepEqual(run.calls, []);
});

test("Coze builds and publishes only in its independent repository", () => {
  assert.doesNotMatch(workflow, /working-directory: apps\/coze|coze-runtime|Check Coze UI/);
});
