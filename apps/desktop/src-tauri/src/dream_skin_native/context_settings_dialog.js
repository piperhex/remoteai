function contextElement(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function contextButton(text, click, className = "") {
  const button = contextElement("button", className, text);
  button.type = "button";
  button.addEventListener("click", click);
  return button;
}

function openContextSettings(entry) {
  if (state.dialog || !entry.conversationId) return;
  closePopover();
  const text = contextSettingsCopy[language()];
  const dialog = contextElement("dialog", "csw-context-settings");
  dialog.dataset.dark = entry.popover.dataset.dark;
  const title = contextElement("h3", "", text.title);
  title.id = `csw-context-settings-${++state.nextId}`;
  dialog.setAttribute("aria-labelledby", title.id);
  const content = contextElement("div", "csw-context-fields");
  const status = contextElement("div", "csw-context-hint", text.loading);
  status.setAttribute("role", "status");
  const error = contextElement("div", "csw-context-error");
  error.setAttribute("role", "alert");
  const editor = { dialog, entry, id: entry.conversationId, identity: entry.identity, text, content, status, error,
    saving: false, loaded: false, adapter: null, input: null, closed: false };
  const close = () => closeContextSettings(editor);
  editor.cancel = contextButton(text.cancel, close);
  editor.save = contextButton(text.save, () => void saveContextSettings(editor), "csw-context-primary");
  editor.save.disabled = true;
  const footer = contextElement("div", "csw-context-actions");
  footer.append(editor.cancel, editor.save);
  dialog.append(title, contextElement("p", "csw-context-hint", text.hint), status, content, error, footer);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  state.dialog = editor;
  document.body.append(dialog);
  dialog.showModal();
  void loadContextSettings(editor);
}

function closeContextSettings(editor, force = false) {
  if (!editor || (editor.saving && !force)) return;
  editor.closed = true;
  editor.dialog.close();
  editor.dialog.remove();
  if (state.dialog === editor) state.dialog = null;
  if (editor.entry.button.isConnected) editor.entry.button.focus({ preventScroll: true });
}

async function loadContextSettings(editor) {
  editor.status.textContent = editor.text.loading;
  editor.error.replaceChildren();
  try {
    const adapter = await state.contextRuntime.forThread(editor.id);
    const capacity = adapter.read(editor.id);
    if (editor.closed) return;
    editor.adapter = adapter;
    editor.loaded = true;
    editor.status.textContent = "";
    editor.save.disabled = false;
    createContextFields(editor, capacity);
    editor.input.focus();
  } catch {
    if (editor.closed) return;
    editor.status.textContent = "";
    editor.error.append(document.createTextNode(editor.text.readError),
      contextButton(editor.text.retry, () => void loadContextSettings(editor)));
  }
}

function createContextFields(editor, capacity) {
  const { text, content } = editor;
  const input = contextElement("input", "");
  input.id = `${editor.dialog.getAttribute("aria-labelledby")}-input`;
  input.inputMode = "decimal";
  input.placeholder = text.placeholder;
  input.value = capacity === null ? "" : String(capacity / TOKENS_PER_K);
  input.setAttribute("list", `${input.id}-presets`);
  const label = contextElement("label", "", text.label);
  label.htmlFor = input.id;
  const presets = contextElement("datalist", "");
  presets.id = `${input.id}-presets`;
  for (const value of CONTEXT_CAPACITY_PRESETS_K) {
    const option = contextElement("option", "", `${value}K`);
    option.value = String(value);
    presets.append(option);
  }
  const help = contextElement("div", "csw-context-help");
  help.append(contextElement("span", "csw-context-hint", text.unit),
    contextButton(text.reset, () => { input.value = ""; input.focus(); }, "csw-context-link"));
  content.replaceChildren(label, input, presets, help, contextElement("p", "csw-context-hint", text.usage));
  input.addEventListener("input", () => { editor.error.textContent = ""; });
  editor.input = input;
}

function contextSaving(editor, saving) {
  editor.saving = saving;
  for (const control of editor.dialog.querySelectorAll("button, input")) control.disabled = saving;
  editor.save.textContent = saving ? editor.text.saving : editor.text.save;
  editor.dialog.setAttribute("aria-busy", String(saving));
}

async function saveContextSettings(editor) {
  if (!editor.loaded || editor.saving || editor.closed) return;
  const capacity = parseContextCapacity(editor.input.value);
  if (capacity === undefined) { editor.error.textContent = editor.text.invalid; return; }
  contextSaving(editor, true);
  editor.error.textContent = "";
  try {
    const update = await editor.adapter.save(editor.id, capacity);
    if (editor.closed) return;
    editor.entry.savedCapacity = capacity;
    contextSaving(editor, false);
    if (update === "paused" || update === "resumeFailed") editor.error.textContent = editor.text[update];
    else closeContextSettings(editor);
  } catch {
    if (!editor.closed) editor.error.textContent = editor.text.saveError;
  } finally {
    if (!editor.closed) contextSaving(editor, false);
  }
}

function addContextSettings(entry) {
  const gear = contextButton("", () => openContextSettings(entry), "csw-context-gear");
  gear.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="1.5" aria-hidden="true"><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-1 1-3 3-1 1-3'
    + ' -2-2 1-3-3-2-3 1-2-2Z"/><circle cx="12" cy="11" r="3"/></svg>';
  entry.gear = gear;
  entry.savedCapacity = null;
  entry.hint = contextElement("div", "csw-context-hint");
  entry.heading.after(gear);
  entry.popover.append(entry.hint);
}

async function readContextHint(entry) {
  const identity = entry.identity;
  entry.savedCapacity = null;
  try {
    const adapter = await state.contextRuntime.forThread(entry.conversationId);
    if (entry.identity === identity) entry.savedCapacity = adapter.read(entry.conversationId);
  } catch { /* The dialog provides retry; usage remains available. */ }
  if (state.open === entry) state.refresh();
}

function updateContextSettings(entry) {
  const text = contextSettingsCopy[language()];
  if (entry.gear.getAttribute("aria-label") !== text.gear) entry.gear.setAttribute("aria-label", text.gear);
  entry.gear.disabled = !entry.conversationId;
  const capacity = entry.savedCapacity;
  setText(entry.hint, capacity === null ? ""
    : `${text.saved(formatContextTokens(capacity, "zh-CN"))}\n${text.lastUsage}`);
}
