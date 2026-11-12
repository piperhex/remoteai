import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function toastHarness({ failLog = false, failMirror = false } = {}) {
  const logged = [];
  const mirrored = [];
  const shown = [];
  const warnings = [];
  const source = readFileSync(new URL("../apps/desktop/src/hooks/useToast.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const mocks = {
    react: {
      useCallback: callback => callback,
      useEffect: () => undefined,
      useMemo: factory => factory(),
      useRef: () => ({ current: undefined }),
      useState: () => [null, message => shown.push(message)],
    },
    "../../../../shared/localization/errors": {
      formatRemoteError: (_language, message) => message,
    },
    "../../../../shared/localization/uiText": { guiLanguage: () => "zh" },
    "../../../../shared/localization/useGuiLanguage": { useGuiLanguage: () => "zh" },
    "../api/errorLogs": {
      recordToastLog: async message => {
        logged.push(message);
        if (failLog) throw new Error("storage unavailable");
      },
    },
    "../api/backend": {
      syncCodexNotification: async message => {
        mirrored.push(message);
        if (failMirror) throw new Error("renderer unavailable");
      },
    },
  };
  runInNewContext(compiled, {
    exports,
    require: name => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import ${name}`);
      return mocks[name];
    },
    window: { clearTimeout: () => undefined, setTimeout: () => 1 },
    console: { debug: message => warnings.push(message) },
  });
  return { ...exports.useToast(), logged, mirrored, shown, warnings };
}

test("every toast is logged once, including success and repeated identical messages", () => {
  const harness = toastHarness();
  const messages = ["保存成功", "请求失败", "请求失败",
    "Saved C:\\Users\\Example\\auth.json; https://example.com/api?token=example-token"];
  for (const message of messages) harness.notify(message);

  assert.deepEqual(harness.logged, messages);
  assert.deepEqual(harness.shown, messages);
  assert.deepEqual(harness.mirrored, messages);
});

test("a missing Codex mirror does not prevent logging or showing the toast", async () => {
  const harness = toastHarness({ failMirror: true });
  harness.notify("已更新设置");
  await Promise.resolve();

  assert.deepEqual(harness.logged, ["已更新设置"]);
  assert.deepEqual(harness.shown, ["已更新设置"]);
  assert.equal(harness.warnings.length, 1);
});

test("a log write failure does not recursively emit another toast", async () => {
  const harness = toastHarness({ failLog: true });
  harness.notify("连接失败");
  await Promise.resolve();

  assert.deepEqual(harness.logged, ["连接失败"]);
  assert.deepEqual(harness.shown, ["连接失败"]);
  assert.deepEqual(harness.mirrored, ["连接失败"]);
  assert.equal(harness.warnings.length, 1);
});
