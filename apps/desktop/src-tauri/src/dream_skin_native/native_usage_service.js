let nativeUsageServiceLoad = null;
const NATIVE_USAGE_ENTRY_LIMIT = 8;
const NATIVE_USAGE_MODULE_LIMIT = 20000;
const NATIVE_USAGE_SCAN_BATCH = 200;

function nativeUsageRead(value, key) {
  try { return value?.[key]; }
  catch { return undefined; } // Cached exports can include inaccessible cross-origin Window proxies.
}

function nativeUsageExportValues(exports) {
  if (!exports || !["object", "function"].includes(typeof exports)) return [];
  try {
    return Object.keys(exports)
      .filter(key => key !== "__webpack_modules__" && key !== "__webpack_require__")
      .map(key => nativeUsageRead(exports, key));
  } catch { return []; } // An unrelated lazy/proxy export must not block the remaining modules.
}

function nativeUsageServiceInExports(exports) {
  for (const value of [exports, ...nativeUsageExportValues(exports)]) {
    // Callable RPC proxies synthesize arbitrary method names and are not service containers.
    if (!value || typeof value !== "object") continue;
    const service = nativeUsageRead(value, "appServerManagers");
    if (typeof nativeUsageRead(service, "subscribe") === "function"
      && typeof nativeUsageRead(service, "openAccount") === "function") return service;
  }
  return null;
}

function nativeUsageEntryUrls() {
  const urls = new Set();
  const add = (href, pattern) => {
    try {
      const url = new URL(href, location.href);
      if (url.protocol === location.protocol && url.host === location.host && pattern.test(url.pathname)) {
        urls.add(url.href);
      }
    } catch { /* Ignore malformed or unavailable application asset URLs. */ }
  };
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    add(link.href, /^\/assets\/app-shared-[\w-]+\.js$/);
  }
  // Import only existing module scripts. Importing a classic script could run the application twice.
  const scripts = [...document.querySelectorAll('script[type="module"][src]')].reverse();
  for (const script of scripts) add(script.src, /^\/assets\/[\w./-]+\.js$/);
  return [...urls].slice(0, NATIVE_USAGE_ENTRY_LIMIT);
}

async function nativeUsageServiceInRuntime(namespace) {
  const require = nativeUsageRead(namespace, "__webpack_require__");
  if (typeof require !== "function") return null;
  const cache = nativeUsageRead(require, "c");
  if (!cache || typeof cache !== "object") return null;
  let entries;
  try { entries = Object.keys(cache).slice(0, NATIVE_USAGE_MODULE_LIMIT); }
  catch { return null; }
  for (let index = 0; index < entries.length; index++) {
    const entry = nativeUsageRead(cache, entries[index]);
    if (entry && !nativeUsageRead(entry, "error")) {
      const service = nativeUsageServiceInExports(nativeUsageRead(entry, "exports"));
      if (service) return service;
    }
    if ((index + 1) % NATIVE_USAGE_SCAN_BATCH === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return null;
}

async function discoverNativeUsageService(importModule) {
  for (const url of nativeUsageEntryUrls()) {
    try {
      const namespace = await importModule(url);
      const service = nativeUsageServiceInExports(namespace) ?? await nativeUsageServiceInRuntime(namespace);
      if (service) return service;
    } catch { /* Another loaded entry can still expose the original usage service. */ }
  }
  return null;
}

async function loadNativeUsageService(importModule = url => import(url)) {
  // Share overlapping discovery, but re-read the live cache after a failed/broken subscription.
  const pending = nativeUsageServiceLoad ??= discoverNativeUsageService(importModule);
  try { return await pending; }
  finally { if (nativeUsageServiceLoad === pending) nativeUsageServiceLoad = null; }
}
