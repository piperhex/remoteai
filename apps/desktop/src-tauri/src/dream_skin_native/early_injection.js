(() => {
  const generationKey = "__CODEX_DREAM_SKIN_EARLY_GENERATION__";
  const appliedKey = "__CODEX_DREAM_SKIN_EARLY_APPLIED__";
  const stopKey = "__CODEX_DREAM_SKIN_EARLY_STOP__";
  // A pending shell is retried by the Rust monitor. Retire the previous
  // observer so late React mounts cannot trigger several copies of the skin.
  if (typeof window[stopKey] === "function") window[stopKey]();
  const generation = __DREAM_SKIN_GENERATION_JSON__;
  const shellSelector = 'main:is(.main-surface, [data-app-shell-main-surface], [class*="_MainContentSurface_"])';
  const settingsSelector = '[data-settings-panel-slug="general-settings"], ' +
    'input[name="appearance-theme"], [data-testid="theme-preview"]';
  window[generationKey] = generation;
  let observer = null;
  let timeout = null;
  const stop = () => {
    observer?.disconnect();
    observer = null;
    if (timeout) clearTimeout(timeout);
    timeout = null;
    if (window[stopKey] === stop) delete window[stopKey];
  };
  window[stopKey] = stop;
  const install = () => {
    if (window[generationKey] !== generation) { stop(); return true; }
    if (!document.documentElement || !document.body || location.protocol !== "app:") return false;
    const main = document.querySelector(shellSelector);
    const primarySurface = main && (document.querySelector("aside.app-shell-left-panel") ||
      main.closest("[data-app-shell-frame]")?.querySelector("header[data-app-shell-titlebar]"));
    if (!primarySurface && !document.querySelector(settingsSelector)) return false;
    stop();
    __DREAM_SKIN_SOURCE__;
    window[appliedKey] = generation;
    return true;
  };
  if (install()) return;
  if (typeof MutationObserver === "function" && document.documentElement) {
    observer = new MutationObserver(install);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  const shellWaitTimeoutMs = 60_000;
  timeout = setTimeout(stop, shellWaitTimeoutMs);
})();
