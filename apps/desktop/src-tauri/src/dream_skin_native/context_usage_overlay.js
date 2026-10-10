const STATE_KEY = "__CODEX_SWITCH_CONTEXT_USAGE__";
const VERSION = 2;
const REFRESH_MS = 1000;
const VIEWPORT_MARGIN = 12;
const POPOVER_GAP = 8;
const previous = window[STATE_KEY];
if (enabled && previous?.version === VERSION) {
  previous.refresh();
  return;
}
previous?.dispose();
if (!enabled) return;

const copy = {
  zh: {
    title: "背景信息窗口", view: "查看上下文用量", empty: "暂无上下文用量", unknown: "上下文容量未知",
    percent: (used, left) => `${used}% 已用（剩余 ${left}%）`,
    tokens: (used, total) => `已用 ${used} Token${total === null ? "" : `，共 ${total}`}`,
  },
  en: {
    title: "Context window", view: "View context usage",
    empty: "No context usage yet", unknown: "Context capacity unknown",
    percent: (used, left) => `${used}% used (${left}% left)`,
    tokens: (used, total) => `${used} tokens used${total === null ? "" : `, ${total} total`}`,
  },
  ru: {
    title: "Контекстное окно", view: "Посмотреть расход контекста",
    empty: "Нет данных о контексте", unknown: "Размер контекста неизвестен",
    percent: (used, left) => `Использовано ${used}% (осталось ${left}%)`,
    tokens: (used, total) => `Использовано ${used} токенов${total === null ? "" : `, всего ${total}`}`,
  },
};
const state = { version: VERSION, entries: new Map(), open: null, frame: null, disposed: false, nextId: 0 };
state.contextRuntime = createContextRuntime();
const stylesheet = document.createElement("style");
stylesheet.textContent = __CONTEXT_USAGE_CSS__;
document.head.append(stylesheet);

function language() {
  const selected = window.__CODEX_SWITCH_SPEED_SELECTOR__?.language ?? document.documentElement.lang;
  return Object.keys(copy).find(key => selected?.startsWith(key)) ?? "zh";
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function closePopover() {
  const entry = state.open;
  if (!entry) return;
  entry.popover.hidden = true;
  entry.button.setAttribute("aria-expanded", "false");
  entry.button.removeAttribute("aria-describedby");
  state.open = null;
}

function positionPopover(entry) {
  const anchor = entry.button.getBoundingClientRect();
  const box = entry.popover.getBoundingClientRect();
  const left = Math.max(VIEWPORT_MARGIN,
    Math.min(anchor.x + (anchor.width - box.width) / 2, innerWidth - box.width - VIEWPORT_MARGIN));
  const above = anchor.top - box.height - POPOVER_GAP;
  const top = above >= VIEWPORT_MARGIN ? above
    : Math.max(VIEWPORT_MARGIN, Math.min(anchor.bottom + POPOVER_GAP, innerHeight - box.height - VIEWPORT_MARGIN));
  entry.popover.style.left = `${left}px`;
  entry.popover.style.top = `${top}px`;
}

function updateEntry(entry, snapshot) {
  const identity = `${location.href}\n${snapshot.conversationId ?? ""}`;
  if (entry.identity !== identity && state.open === entry) closePopover();
  if (entry.identity !== identity) {
    entry.savedCapacity = null;
    if (state.dialog?.entry === entry) closeContextSettings(state.dialog, true);
  }
  entry.identity = identity;
  entry.conversationId = snapshot.conversationId;
  updateContextSettings(entry);
  const text = copy[language()];
  const usage = snapshot.value;
  if (entry.button.getAttribute("aria-label") !== text.view) entry.button.setAttribute("aria-label", text.view);
  setText(entry.heading, text.title);
  const status = usage?.percent == null ? text.unknown : text.percent(usage.percent, FULL_PERCENT - usage.percent);
  setText(entry.status, usage ? status : text.empty);
  // The GUI uses the same compact number format for all interface languages.
  const total = usage?.capacity == null ? null : formatContextTokens(usage.capacity, "zh-CN");
  setText(entry.tokens, usage ? text.tokens(formatContextTokens(usage.used, "zh-CN"), total) : "");
  entry.progress.setAttribute("stroke-dasharray", `${usage?.percent ?? 0} ${FULL_PERCENT}`);
  const color = getComputedStyle(entry.button).color.match(/[\d.]+/g)?.map(Number) ?? [];
  const dark = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722 > 150;
  entry.popover.dataset.dark = String(dark);
  entry.button.style.setProperty("--csw-context-hover", dark ? "#343b38" : "#e8f2eb");
  const tooltipId = entry.native.getAttribute("aria-describedby");
  const description = tooltipId ? document.getElementById(tooltipId) : null;
  const tooltip = description?.closest("[data-radix-popper-content-wrapper]") ?? description;
  if (entry.tooltip !== tooltip) entry.tooltip?.removeAttribute("data-csw-context-tooltip");
  entry.tooltip = tooltip;
  tooltip?.setAttribute("data-csw-context-tooltip", "");
  if (state.open === entry) positionPopover(entry);
}

function createRing() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ width: "14", height: "14", viewBox: "0 0 16 16",
    fill: "none", "aria-hidden": "true" })) svg.setAttribute(key, value);
  for (const track of [true, false]) {
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    for (const [key, value] of Object.entries({ cx: "8", cy: "8", r: "6", stroke: "currentColor",
      "stroke-width": "2", pathLength: String(FULL_PERCENT) })) circle.setAttribute(key, value);
    if (track) circle.style.opacity = "0.2";
    else circle.setAttribute("transform", "rotate(-90 8 8)");
    svg.append(circle);
  }
  return svg;
}

function createEntry(native, empty = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "csw-context-button no-drag";
  button.setAttribute("aria-expanded", "false");
  const ring = createRing();
  button.append(ring);
  const popover = document.createElement("div");
  popover.className = "csw-context-popover";
  popover.id = `csw-context-${++state.nextId}`;
  popover.setAttribute("role", "status");
  popover.hidden = true;
  const heading = document.createElement("div");
  heading.className = "csw-context-heading";
  const status = document.createElement("div");
  const tokens = document.createElement("div");
  popover.append(heading, status, tokens);
  const entry = {
    native, empty, button, popover, heading, status, tokens,
    progress: ring.lastElementChild, identity: null, tooltip: null,
  };
  addContextSettings(entry);
  for (const name of ["pointerdown", "mousedown"]) button.addEventListener(name, event => event.stopPropagation());
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const wasOpen = state.open === entry;
    closePopover();
    if (wasOpen) return;
    const snapshot = empty ? emptyNativeContext(native.closest(COMPOSER_SELECTOR))?.snapshot : readNativeContext(native);
    if (!snapshot) return;
    updateEntry(entry, snapshot);
    state.open = entry;
    popover.hidden = false;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-describedby", popover.id);
    positionPopover(entry);
    void readContextHint(entry);
  });
  if (empty) native.append(button);
  else native.before(button);
  document.body.append(popover);
  if (!empty) native.setAttribute("data-csw-context-native", "");
  return entry;
}

function removeEntry(entry) {
  if (state.dialog?.entry === entry) closeContextSettings(state.dialog, true);
  if (state.open === entry) closePopover();
  entry.native.removeAttribute("data-csw-context-native");
  entry.tooltip?.removeAttribute("data-csw-context-tooltip");
  entry.button.remove();
  entry.popover.remove();
  state.entries.delete(entry.native);
}

function refresh() {
  if (state.disposed) return;
  state.contextRuntime.refresh();
  const found = new Set();
  // Bound discovery to composer indicators; never scan conversation content or history.
  for (const composer of document.querySelectorAll(COMPOSER_SELECTOR)) {
    if (!composer.getClientRects().length) continue;
    for (const native of composer.querySelectorAll('[role="img"][aria-label]')) {
      const snapshot = readNativeContext(native);
      if (!snapshot) continue;
      found.add(native);
      let entry = state.entries.get(native);
      if (entry && !entry.button.isConnected) { removeEntry(entry); entry = null; }
      if (!entry) { entry = createEntry(native); state.entries.set(native, entry); }
      updateEntry(entry, snapshot);
    }
    const empty = emptyNativeContext(composer);
    if (empty) {
      found.add(empty.native);
      let entry = state.entries.get(empty.native);
      if (!entry) { entry = createEntry(empty.native, true); state.entries.set(empty.native, entry); }
      updateEntry(entry, empty.snapshot);
    }
  }
  for (const [native, entry] of state.entries) if (!found.has(native)) removeEntry(entry);
}

function scheduleRefresh() {
  if (state.frame !== null || state.disposed) return;
  state.frame = requestAnimationFrame(() => { state.frame = null; refresh(); });
}

function onPointerDown(event) {
  const entry = state.open;
  if (entry && !entry.button.contains(event.target) && !entry.popover.contains(event.target)) closePopover();
}

function onKeyDown(event) {
  if (event.key === "Escape" && state.open) {
    const button = state.open.button;
    closePopover();
    button.focus({ preventScroll: true });
    event.stopPropagation();
  }
}

const observer = new MutationObserver(scheduleRefresh);
observer.observe(document.documentElement, {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ["aria-label", "aria-describedby", "class", "lang"],
});
// The fallback covers commits which update props without a DOM mutation; it performs no I/O.
const timer = setInterval(scheduleRefresh, REFRESH_MS);
document.addEventListener("pointerdown", onPointerDown, true);
document.addEventListener("keydown", onKeyDown, true);
window.addEventListener("resize", scheduleRefresh);
document.addEventListener("scroll", scheduleRefresh, true);
state.refresh = refresh;
state.dispose = () => {
  state.disposed = true;
  closeContextSettings(state.dialog, true);
  state.contextRuntime.dispose();
  observer.disconnect();
  clearInterval(timer);
  if (state.frame !== null) cancelAnimationFrame(state.frame);
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("resize", scheduleRefresh);
  document.removeEventListener("scroll", scheduleRefresh, true);
  for (const entry of state.entries.values()) removeEntry(entry);
  for (const node of document.querySelectorAll("[data-csw-context-tooltip]")) {
    node.removeAttribute("data-csw-context-tooltip");
  }
  stylesheet.remove();
  if (window[STATE_KEY] === state) delete window[STATE_KEY];
};
window[STATE_KEY] = state;
refresh();
