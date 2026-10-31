import { readFileSync } from "node:fs";

const root = new URL("../../apps/desktop/src-tauri/src/dream_skin_native/", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8");
const metrics = readFileSync(new URL("../../shared/context-usage/metrics.js", import.meta.url), "utf8");
const footerCss = readFileSync(new URL("../../shared/chat/usageFooter.css", import.meta.url), "utf8");
const body = [read("native_registry_reader.js"), read("native_usage_subscription.js"), read("context_usage_reader.js"),
  metrics.replaceAll("export ", ""), read("usage_statusline.js")
    .replace("__USAGE_STATUSLINE_CSS__", JSON.stringify(`${read("usage_statusline.css")}\n${footerCss}`))].join("\n");
const install = `window.__CODEX_SWITCH_REFRESH_USAGE_STATUSLINE__ = () => { ${body} };`;
const refresh = "window.__CODEX_SWITCH_REFRESH_USAGE_STATUSLINE__();";
const selector = read("speed_selector_overlay.rs");
const selectorBody = selector.slice(selector.indexOf('r#"') + 3, selector.lastIndexOf('"#;'));

export const usageStatuslineScript = `${install}\n${refresh}`;
export const composerUsageOverlayForTier = (tier = 'default') =>
  `${install}\n${selectorBody.replace("__CODEX_SWITCH_SERVICE_TIER__", JSON.stringify(tier))}\n${refresh}`;
export const composerUsageOverlay = composerUsageOverlayForTier();
