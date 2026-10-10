import { readFile } from "node:fs/promises";

const root = new URL("../../apps/desktop/src-tauri/src/dream_skin_native/", import.meta.url);
const [values, reader, overlay, css] = await Promise.all([
  readFile(new URL("../../shared/context-usage/values.js", import.meta.url), "utf8"),
  readFile(new URL("context_usage_reader.js", root), "utf8"),
  readFile(new URL("context_usage_overlay.js", root), "utf8"),
  readFile(new URL("context_usage_overlay.css", root), "utf8"),
]);
const settings = (await readFile(new URL("../../shared/context-usage/settings.js", import.meta.url), "utf8"))
  .replaceAll("export ", "");
const settingsCode = (await Promise.all(["context_settings_change.js", "context_settings_runtime.js",
  "context_settings_adapter.js", "context_settings_copy.js", "context_settings_dialog.js"]
  .map(file => readFile(new URL(file, root), "utf8")))).join("\n");

export function contextOverlay(enabled = true) {
  return `(() => { const enabled = ${enabled};\n${values.replaceAll("export ", "")}\n${reader}\n`
    + `${settings}\n${settingsCode}\n${overlay.replace("__CONTEXT_USAGE_CSS__", JSON.stringify(css))}\n})();`;
}

export async function setContext(page, { used = 30_260, capacity = 258_400, thread = "one", alternate = false } = {}) {
  await page.evaluate(({ used, capacity, thread, alternate }) => {
    const native = document.getElementById("native");
    const usage = { usedTokens: used, contextWindow: capacity };
    const root = { stateNode: {} };
    root.stateNode.current = root;
    const owner = { memoizedProps: { contextUsage: usage, conversationId: thread }, return: root };
    const host = { memoizedProps: {}, return: owner };
    if (alternate) {
      const old = native.__reactFiber$fixture;
      old.alternate = host;
      const oldRoot = old.return.return;
      oldRoot.stateNode.current = root;
    } else native.__reactFiber$fixture = host;
    native.setAttribute("aria-label", `上下文用量：${used / capacity * 100}%`);
  }, { used, capacity, thread, alternate });
}

export async function setupContext(page, { dark = false, edge = "right" } = {}) {
  await page.evaluate(() => window.__CODEX_SWITCH_CONTEXT_USAGE__?.dispose());
  await page.setContent(`<style>
    body { font: 14px system-ui; margin: 12px; color: ${dark ? "#eee" : "#222"};
      background: ${dark ? "#202522" : "#fff"}; --text-tertiary: ${dark ? "#abb8b0" : "#718078"}; }
    [data-codex-composer-root] { margin-top: 180px; border: 1px solid #aaa; padding: 12px; border-radius: 16px; }
    #toolbar { display: flex; align-items: center; justify-content: ${edge === "right" ? "flex-end" : "flex-start"}; }
    [contenteditable] { min-height: 48px; }
  </style><div data-codex-composer-root><div contenteditable="true" aria-label="Message">Draft</div>
    <div id="toolbar"><span><span id="native" role="img" aria-label="上下文用量：12%">◉</span></span>
    <div><div><button data-composer-navigation-target="reasoning">GPT-6-Astra</button></div></div>
    </div></div>`);
  await setContext(page);
  await page.evaluate(contextOverlay());
}
