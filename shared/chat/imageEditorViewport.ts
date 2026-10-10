// View changes affect only the preview; drawing and exports always use the original image coordinates.
export const imageEditorViewport = String.raw`
const viewport = { zoom: 1, x: 0, y: 0, panning: false, drag: null };
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const panButton = document.querySelector('#pan');
const zoomOut = document.querySelector('#zoom-out');
const zoomIn = document.querySelector('#zoom-in');
const fitButton = document.querySelector('#fit');
const widthSlider = document.querySelector('#stroke-width');

function fit() {
  if (!ready) return;
  const style = getComputedStyle(stage);
  const availableWidth = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availableHeight = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height) * viewport.zoom;
  const previewWidth = Math.max(1, canvas.width * scale);
  const previewHeight = Math.max(1, canvas.height * scale);
  const maxX = Math.max(0, (previewWidth - availableWidth) / 2);
  const maxY = Math.max(0, (previewHeight - availableHeight) / 2);
  viewport.x = Math.max(-maxX, Math.min(maxX, viewport.x));
  viewport.y = Math.max(-maxY, Math.min(maxY, viewport.y));
  canvas.style.width = previewWidth + 'px';
  canvas.style.height = previewHeight + 'px';
  canvas.style.transform = 'translate(' + viewport.x + 'px, ' + viewport.y + 'px)';
  if (!zoomOut) return;
  zoomOut.disabled = viewport.zoom <= MIN_ZOOM;
  zoomIn.disabled = viewport.zoom >= MAX_ZOOM;
  document.querySelector('#zoom-value').textContent = Math.round(viewport.zoom * 100) + '%';
}
function setPanning(panning) {
  viewport.panning = panning;
  panButton?.setAttribute('aria-pressed', String(panning));
  canvas.style.cursor = panning ? 'grab' : 'crosshair';
  stage.style.cursor = panning ? 'grab' : '';
  if (ready && panning) notice.textContent = config.labels.panHint;
}
function changeZoom(zoom) {
  if (!ready || current || saving || viewport.drag) return;
  viewport.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  fit();
}
function resetViewport() {
  if (current || viewport.drag) return;
  viewport.x = viewport.y = 0;
  changeZoom(1);
}
function syncWidth() {
  if (!widthSlider) return;
  widthSlider.value = String(width);
  const minimum = Number(widthSlider.min);
  const maximum = Number(widthSlider.max);
  widthSlider.style.setProperty('--fill', ((width - minimum) / (maximum - minimum) * 100) + '%');
  document.querySelector('#stroke-width-value').textContent = width + ' px';
}
widthSlider?.addEventListener('input', () => {
  width = Number(widthSlider.value);
  syncWidth();
  selectButton('[data-width]', document.querySelector('[data-width="' + width + '"]'));
});
zoomOut?.addEventListener('click', () => changeZoom(viewport.zoom - ZOOM_STEP));
zoomIn?.addEventListener('click', () => changeZoom(viewport.zoom + ZOOM_STEP));
fitButton?.addEventListener('click', resetViewport);
panButton?.addEventListener('click', () => {
  if (!ready || current || saving) return;
  setPanning(!viewport.panning);
  selectButton('[data-tool]', viewport.panning ? null : document.querySelector('[data-tool="' + tool + '"]'));
  if (!viewport.panning) updateToolHint();
});
stage.addEventListener('pointerdown', (event) => {
  if (!ready || saving || !viewport.panning || viewport.drag || !event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  viewport.drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
    startX: viewport.x, startY: viewport.y };
  stage.setPointerCapture(event.pointerId);
  canvas.style.cursor = stage.style.cursor = 'grabbing';
}, true);
stage.addEventListener('pointermove', (event) => {
  const drag = viewport.drag;
  if (!drag || drag.id !== event.pointerId) return;
  event.preventDefault();
  viewport.x = drag.startX + event.clientX - drag.x;
  viewport.y = drag.startY + event.clientY - drag.y;
  fit();
});
function finishPan(event) {
  if (viewport.drag?.id !== event.pointerId) return;
  viewport.drag = null;
  setPanning(viewport.panning);
}
stage.addEventListener('pointerup', finishPan);
stage.addEventListener('pointercancel', finishPan);
stage.addEventListener('lostpointercapture', finishPan);
// Returning to the phone layout must leave the image drawable and fully visible.
const desktopMedia = matchMedia('(min-width: 900px)');
desktopMedia.addEventListener('change', () => {
  if (!config.desktop || desktopMedia.matches) return;
  viewport.drag = null;
  setPanning(false);
  if (tool === 'circle') tool = 'pen';
  resetViewport();
  selectButton('[data-tool]', document.querySelector('[data-tool="' + tool + '"]'));
  updateToolHint();
});
`;
