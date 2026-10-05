export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface DesktopViewport { stage: Size; content: Size & Point; edgePan?: Point }
export interface DesktopPanState { offset: Point; point: Point; edge?: Point }
export const MOUSE_SIZE = { width: 120, height: 136 };
export const MOUSE_PANEL_SIZE = MOUSE_SIZE;
export const MOUSE_ICON_SIZE = { width: 40, height: 40 };
export const CURSOR_SIZE = { width: 18, height: 24 };
const PANEL_GAP = CURSOR_SIZE.width + 6;
const EDGE_GAP = 8;
const EDGE_PAN_GAIN = { x: 1, y: 2 };
const EDGE_MOTION_SHARE = 0.5;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Fit the complete desktop inside the available stage, preserving its aspect ratio. */
export function desktopViewport(stage: Size, source: Size): DesktopViewport {
  const heightScale = stage.height / Math.max(source.height, 1);
  const scale = Math.min(stage.width / Math.max(source.width, 1), heightScale);
  const width = source.width * scale; const height = source.height * scale;
  return { stage, content: { width, height, x: (stage.width - width) / 2, y: (stage.height - height) / 2 } };
}
export function cursorPosition(point: Point, { content }: DesktopViewport): Point {
  return { x: content.x + point.x * Math.max(0, content.width - 1),
    y: content.y + point.y * Math.max(0, content.height - 1) };
}
export function desktopPoint(point: Point, { content }: DesktopViewport, clampOutside = false): Point | undefined {
  const x = point.x - content.x; const y = point.y - content.y;
  if (!clampOutside && (x < 0 || y < 0 || x >= content.width || y >= content.height)) return;
  return { x: clamp(x / Math.max(1, content.width - 1), 0, 1),
    y: clamp(y / Math.max(1, content.height - 1), 0, 1) };
}

/** Keep the cursor at the panel's upper-left, including outside the video or viewer. */
export function mousePanelPosition(cursor: Point): Point {
  return { x: cursor.x + PANEL_GAP, y: cursor.y };
}

function panAxis(cursor: number, edge: number, previous = 0) {
  const remaining = edge - cursor;
  const limit = remaining < 0 ? remaining * EDGE_MOTION_SHARE : remaining;
  return clamp(Math.max(0, previous), EDGE_GAP - cursor, limit);
}

/** Retain an active edge through idle collapse/expansion until the pointer moves back inside it. */
function panEdges(natural: Point, previous?: DesktopPanState): Point {
  const retained = previous?.edge;
  if (!previous || !retained) return natural;
  return {
    x: previous.offset.x < 0 || previous.point.x > natural.x ? retained.x : natural.x,
    y: previous.offset.y < 0 || previous.point.y > natural.y ? retained.y : natural.y,
  };
}

/** Split edge motion equally between revealing black canvas and advancing the cursor/panel. */
export function panDesktopViewport(viewport: DesktopViewport, point: Point, panel: Size, previous?: DesktopPanState) {
  const { stage, content } = viewport;
  const edge = panEdges({
    x: (stage.width - EDGE_GAP - PANEL_GAP - panel.width - content.x) / Math.max(1, content.width - 1),
    y: (stage.height - EDGE_GAP - panel.height - content.y) / Math.max(1, content.height - 1),
  }, previous);
  const cursor = cursorPosition(point, viewport);
  const boundary = cursorPosition(edge, viewport);
  const x = panAxis(cursor.x, boundary.x, previous?.offset.x);
  const y = panAxis(cursor.y, boundary.y, previous?.offset.y);
  return { point, edge, offset: { x, y }, viewport: { ...viewport, edgePan: edge,
    content: { ...content, x: content.x + x, y: content.y + y } } };
}

function edgeDelta(position: number, delta: number, boundary: number, gain: number) {
  // Work in gesture distance so a single event crossing an edge matches many smaller events.
  const start = position <= boundary ? position : boundary + (position - boundary) / gain;
  const end = start + delta;
  return (end <= boundary ? end : boundary + (end - boundary) * gain) - position;
}

/** Preserve normal speed until the controls reach an edge; match their speed to the exposed margin after it. */
export function relativeDesktopDelta(point: Point, delta: Point, viewport: DesktopViewport): Point {
  if (!viewport.edgePan) return delta;
  const width = Math.max(1, viewport.content.width - 1);
  const height = Math.max(1, viewport.content.height - 1);
  return {
    x: edgeDelta(point.x * width, delta.x, viewport.edgePan.x * width, EDGE_PAN_GAIN.x / EDGE_MOTION_SHARE),
    y: edgeDelta(point.y * height, delta.y, viewport.edgePan.y * height, EDGE_PAN_GAIN.y / EDGE_MOTION_SHARE),
  };
}
