import { imageEditorDrawing } from './imageEditorDrawing';
import { imageEditorDialogScript } from './imageEditorDialogScript';
import { imageEditorViewport } from './imageEditorViewport';

// Kept as a self-contained script so it runs identically in the native WebView and sandboxed iframe.
export const imageEditorScript = String.raw`
const canvas = document.querySelector('canvas');
const context = canvas.getContext('2d');
const stage = document.querySelector('#stage');
const notice = document.querySelector('#notice');
const done = document.querySelector('#done');
const undo = document.querySelector('#undo');
const redo = document.querySelector('#redo');
const reset = document.querySelector('#reset');
const image = new Image();
const strokes = [];
const undone = [];
let current = null;
let pointer = null;
let tool = 'pen';
let color = '#ef4444';
let width = config.desktop ? 4 : 6;
let ready = false;
let saving = false;
const FREEHAND_TOOLS = new Set(['pen', 'mosaic', 'eraser']);
const STROKE_REFERENCE_EDGE = 600;

${imageEditorDrawing}
${imageEditorDialogScript}
${imageEditorViewport}

function send(message) {
  const payload = JSON.stringify(message);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(payload);
  else window.parent.postMessage(payload, '*');
}
function render() {
  if (!ready) return;
  drawing.clearRect(0, 0, layer.width, layer.height);
  const lastReset = strokes.map(stroke => stroke.tool).lastIndexOf('reset');
  strokes.slice(lastReset + 1).forEach(drawStroke);
  if (current) drawStroke(current);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.drawImage(layer, 0, 0);
  const busy = !!current || saving;
  undo.disabled = !strokes.length || busy;
  redo.disabled = !undone.length || busy;
  redo.hidden = !config.desktop && !undone.length;
  reset.disabled = strokes.length === lastReset + 1 || busy;
  done.disabled = busy;
}
function point(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)) };
}
canvas.addEventListener('pointerdown', (event) => {
  if (!ready || saving || viewport.panning || pointer !== null || !event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  pointer = event.pointerId;
  canvas.setPointerCapture(pointer);
  current = { tool, color, width: config.desktop ? width
    : width * Math.max(canvas.width, canvas.height) / STROKE_REFERENCE_EDGE,
    points: [point(event)] };
  render();
});
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== pointer || !current) return;
  event.preventDefault();
  const next = point(event);
  if (current.tool === 'text') return;
  if (FREEHAND_TOOLS.has(current.tool)) current.points.push(next);
  else current.points = [current.points[0], next];
  render();
});
function finish(event) {
  if (event.pointerId !== pointer || !current) return;
  if (event.type === 'pointerup') {
    const next = point(event);
    if (FREEHAND_TOOLS.has(current.tool)) current.points.push(next);
    else current.points = [current.points[0], next];
    if (current.tool === 'text') openText(current);
    else { strokes.push(current); undone.length = 0; }
  }
  current = null;
  pointer = null;
  render();
}
canvas.addEventListener('pointerup', finish);
canvas.addEventListener('pointercancel', finish);
canvas.addEventListener('lostpointercapture', finish);
function selectButton(selector, button) {
  document.querySelectorAll(selector).forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}
function updateToolHint() {
  const hints = { text: config.labels.textHint, eraser: config.labels.eraserHint };
  if (ready) notice.textContent = hints[tool] || config.labels.hint;
}
document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => {
  tool = button.dataset.tool;
  setPanning(false);
  selectButton('[data-tool]', button);
  updateToolHint();
}));
document.querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => {
  color = button.dataset.color;
  selectButton('#colors button', button);
}));
document.querySelectorAll('[data-width]').forEach((button) => button.addEventListener('click', () => {
  width = Number(button.dataset.width);
  selectButton('[data-width]', button);
  syncWidth();
}));
undo.addEventListener('click', () => { if (strokes.length) undone.push(strokes.pop()); render(); });
redo.addEventListener('click', () => { if (undone.length) strokes.push(undone.pop()); render(); });
reset.addEventListener('click', () => { strokes.push({ tool: 'reset' }); undone.length = 0; render(); });
document.querySelector('#cancel').addEventListener('click', () => send({ type: 'cancel' }));
window.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') send({ type: 'cancel' });
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey
    || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
  if (event.target instanceof HTMLElement
    && event.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) undo.click();
});
function exportImage() {
  if (!strokes.length || strokes[strokes.length - 1].tool === 'reset') return config.dataUrl;
  const output = document.createElement('canvas');
  const outputContext = output.getContext('2d');
  let edge = Math.min(config.maxEdge, Math.max(canvas.width, canvas.height));
  // The original can be smaller than the normal compression floor.
  const floor = Math.min(128, edge);
  while (edge >= floor) {
    const scale = edge / Math.max(canvas.width, canvas.height);
    output.width = Math.max(1, Math.round(canvas.width * scale));
    output.height = Math.max(1, Math.round(canvas.height * scale));
    outputContext.drawImage(canvas, 0, 0, output.width, output.height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const url = output.toDataURL('image/jpeg', quality);
      if (url.length * 3 / 4 <= config.targetBytes) return url;
    }
    edge = Math.floor(edge / 2);
  }
  throw new Error('image-too-large');
}
done.addEventListener('click', () => {
  if (!ready || current || saving) return;
  saving = true;
  render();
  notice.textContent = config.labels.saving;
  // Let the saving state paint before encoding on the WebView thread.
  setTimeout(() => {
    try { send({ type: 'save', dataUrl: exportImage() }); }
    catch { notice.textContent = config.labels.saveFailed; }
    finally { saving = false; render(); }
  }, 30);
});
image.onload = () => {
  if (!context || !drawing || !mosaicContext || !brushContext) {
    notice.textContent = config.labels.unavailable; return;
  }
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  prepareLayers();
  ready = true;
  fit(); render();
  notice.textContent = config.labels.hint;
};
image.onerror = () => { notice.textContent = config.labels.readFailed; };
new ResizeObserver(fit).observe(stage);
image.src = config.dataUrl;
document.documentElement.dataset.editorInitialized = 'true';
`;
