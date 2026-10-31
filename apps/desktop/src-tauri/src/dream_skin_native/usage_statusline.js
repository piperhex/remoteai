const KEY = "__CODEX_SWITCH_USAGE_STATUSLINE__";
const VERSION = 10;
const REFRESH_MS = 1000;
const TIMING_REFRESH_MS = 2000;
const TIMING_TIMEOUT_MS = 10000;
const previous = window[KEY];
function isStatuslineEnabled() {
  const owner = window.__CODEX_SWITCH_SPEED_SELECTOR__;
  // Daily accounting controls only its own node; conversation metrics follow proxy availability.
  return window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ === true && owner?.installed;
}
if (!isStatuslineEnabled()) { previous?.dispose(); return; }
if (previous?.version === VERSION) { void previous.refresh(); return; }
previous?.dispose();
// i18n:usage-statusline:start
const copy = {
  zh: {
    label: "会话用量统计", cache: value => `缓存命中 ${value}`,
    speedHint: "当前会话已完成请求的平均输出速度，使用 Remote AI 的请求计时。",
    cacheHint: "当前会话累计缓存输入 Token 占累计输入 Token 的比例。",
    contextHint: "当前会话的上下文占用，与账号剩余额度无关。",
    waiting: "等待当前会话的用量数据。",
  },
  en: {
    label: "Conversation usage", cache: value => `Cache hit ${value}`,
    speedHint: "Average output speed of completed requests in this conversation, using Remote AI request timings.",
    cacheHint: "Cumulative cached input tokens as a share of cumulative input tokens in this conversation.",
    contextHint: "Context used by this conversation, separate from account quota.",
    waiting: "Waiting for this conversation's usage data.",
  },
  ru: {
    label: "Расход в диалоге", cache: value => `Попадания в кеш ${value}`,
    speedHint: "Средняя скорость вывода завершённых запросов диалога по замерам Remote AI.",
    cacheHint: "Доля кешированных входных токенов среди всех входных токенов диалога.",
    contextHint: "Расход контекста этого диалога, отдельно от лимита аккаунта.",
    waiting: "Ожидание данных о расходе в этом диалоге.",
  },
  ja: {
    label: "会話の使用状況", cache: value => `キャッシュ命中率 ${value}`,
    speedHint: "この会話で完了したリクエストの平均出力速度。",
    cacheHint: "この会話の累計入力トークンに占めるキャッシュ済みトークンの割合。",
    contextHint: "この会話のコンテキスト使用率。アカウントの残り利用枠とは異なります。",
    waiting: "この会話の使用状況を取得しています。",
  },
};
// i18n:usage-statusline:end
const state = { version: VERSION, disposed: false, busy: false, registry: null,
  nextDiscovery: 0, records: new Map(), timings: new Map(), node: null, parts: [],
  timingRequest: null, timingConversationId: null, nextTiming: 0 };
const nativeUsage = createNativeUsageSubscription({ onChange: () => { void refresh(); } });
const style = document.createElement("style");
style.textContent = __USAGE_STATUSLINE_CSS__;
document.head.append(style);
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
function text() {
  const language = window.__CODEX_SWITCH_SPEED_SELECTOR__?.language;
  return copy[language] ?? copy.en;
}

function createStatusline() {
  const node = document.createElement("div");
  node.className = "cs-usage-footer-container";
  node.dataset.codexSwitchUsageStatusline = "true";
  node.setAttribute("role", "status");
  const paths = ["M2 12a6 6 0 0 1 12 0M8 12l3-5",
    "M3 4c0-2 10-2 10 0s-10 2-10 0v8c0 2 10 2 10 0V4M3 8c0 2 10 2 10 0",
    null];
  state.parts = paths.map((shape, index) => {
    const item = document.createElement("span");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("aria-hidden", "true");
    let progress = null;
    if (index === 2) progress = createContextProgress(svg);
    else {
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", shape); svg.append(path);
    }
    const value = document.createElement("span");
    item.dataset.usageMetric = String(index); item.append(svg, value); node.append(item);
    return { item, value, progress };
  });
  return node;
}

function createContextProgress(svg) {
  let progress;
  for (const track of [true, false]) {
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    for (const [key, value] of Object.entries({ cx: "8", cy: "8", r: "6", pathLength: "100" })) {
      circle.setAttribute(key, value);
    }
    if (track) circle.style.opacity = "0.2";
    else {
      circle.setAttribute("transform", "rotate(-90 8 8)");
      circle.setAttribute("stroke-dasharray", "0 100");
      circle.setAttribute("stroke-linecap", "butt");
      circle.dataset.contextProgress = "true";
      progress = circle;
    }
    svg.append(circle);
  }
  return progress;
}

function renderMetrics(metrics) {
  const labels = text();
  const percent = value => number(value) ? `${value.toFixed(1)}%` : "—";
  const values = [number(metrics?.speed) ? `${metrics.speed.toFixed(1)} tok/s` : "— tok/s",
    labels.cache(percent(metrics?.cacheHit)), percent(metrics?.contextPercent)];
  const hints = metrics ? [labels.speedHint, labels.cacheHint, labels.contextHint] : Array(3).fill(labels.waiting);
  state.node.setAttribute("aria-label", labels.label);
  state.parts.forEach(({ item, value, progress }, index) => {
    if (value.textContent !== values[index]) value.textContent = values[index];
    if (item.title !== hints[index]) item.title = hints[index];
    if (progress) {
      const used = number(metrics?.contextPercent) ? Number(Math.min(100, metrics.contextPercent).toFixed(1)) : 0;
      progress.setAttribute("stroke-dasharray", `${used} 100`);
    }
  });
}

function activeComposer() {
  const candidates = document.querySelectorAll("[data-composer-surface-variant], .composer-surface-chrome");
  return [...candidates].find(card => card.getClientRects().length
    && card.querySelector('[contenteditable="true"], textarea:not(:disabled)')) ?? null;
}

function activeConversationId(card) {
  const root = card.closest("[data-codex-composer-root]") ?? card;
  if (root.getAttribute("data-composer-placement") === "home") return null;
  const identity = root.querySelector("[data-above-composer-conversation-id]")
    ?.getAttribute("data-above-composer-conversation-id") ?? composerConversationId(root);
  return typeof identity === "string" && identity.length <= 160 ? identity : null;
}

async function discoverRegistry() {
  if (state.registry || Date.now() < state.nextDiscovery) return;
  state.nextDiscovery = Date.now() + 5000;
  state.registry = await findContextRegistry(() => state.disposed);
}

function readMetrics(id) {
  // Only read the selected local conversation. Never request/resume a thread or wrap its transport.
  const manager = state.registry?.getImplForHostId("local");
  const conversation = manager?.getConversation?.(id);
  const subscribed = nativeUsage.get(id);
  const snapshot = subscribed ? { latestTokenUsageInfo: subscribed }
    : conversation?.resumeState === "needs_resume" ? null : conversation;
  const metrics = composerUsageMetrics(snapshot, state.timings.get(id));
  if (metrics) state.records.set(id, metrics);
  if (state.records.size > 64) state.records.delete(state.records.keys().next().value);
  return metrics;
}

function requestTiming(id) {
  if (typeof window.codexSwitchRequestConversationMetrics !== "function") return;
  const now = Date.now();
  const pending = state.timingRequest;
  if (pending?.conversationId === id && now - pending.time < TIMING_TIMEOUT_MS) return;
  if (pending?.conversationId === id) state.timings.delete(id);
  if (state.timingConversationId === id && now < state.nextTiming) return;
  // Keep identities unique across disposal and reinstallation, including within the same millisecond.
  const requestId = Math.max(now * 1000, (window.__CODEX_SWITCH_USAGE_TIMING_REQUEST_ID__ ?? 0) + 1);
  window.__CODEX_SWITCH_USAGE_TIMING_REQUEST_ID__ = requestId;
  const request = { conversationId: id, requestId, time: now };
  state.timingRequest = request;
  state.timingConversationId = id;
  state.nextTiming = now + TIMING_REFRESH_MS;
  try {
    window.codexSwitchRequestConversationMetrics(JSON.stringify({ conversationId: id, requestId: request.requestId }));
  } catch { state.timingRequest = null; state.timings.delete(id); }
}

function receiveTiming(id, requestId, timing) {
  if (state.disposed || state.timingRequest?.conversationId !== id
    || state.timingRequest?.requestId !== requestId) return;
  state.timingRequest = null;
  state.timings.set(id, timing);
  if (state.timings.size > 64) state.timings.delete(state.timings.keys().next().value);
  void refresh();
}

async function refresh() {
  if (!isStatuslineEnabled()) { api.dispose(); return; }
  if (state.disposed || state.busy || document.hidden) return;
  const card = activeComposer();
  if (!card) { nativeUsage.select(null); if (state.node) state.node.hidden = true; return; }
  state.node ??= createStatusline();
  const dailyUsage = window.__CODEX_SWITCH_SPEED_SELECTOR__?.usageNode;
  if (dailyUsage && dailyUsage.parentElement !== state.node) state.node.append(dailyUsage);
  if (card.nextElementSibling !== state.node) card.after(state.node);
  state.node.hidden = false;
  const id = activeConversationId(card);
  nativeUsage.select(id);
  renderMetrics(id ? state.records.get(id) : null);
  if (!id) { state.timingRequest = null; state.timingConversationId = null; return; }
  state.busy = true;
  try {
    if (!nativeUsage.supported) await discoverRegistry();
    if (!state.disposed && activeConversationId(card) === id && card.isConnected) {
      requestTiming(id);
      renderMetrics(readMetrics(id));
    }
  } catch { if (!state.disposed) { state.registry = null; renderMetrics(null); } }
  finally { state.busy = false; }
}

const timer = setInterval(refresh, REFRESH_MS);
const onVisible = () => { if (document.hidden) nativeUsage.select(null); else void refresh(); };
document.addEventListener("visibilitychange", onVisible);
const api = { version: VERSION, refresh, receiveTiming, dispose() {
  state.disposed = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible);
  nativeUsage.dispose();
  state.node?.remove(); style.remove(); state.records.clear(); state.timings.clear(); state.timingRequest = null;
  state.registry = null;
  if (window[KEY] === api) delete window[KEY];
} };
window[KEY] = api;
void refresh();
