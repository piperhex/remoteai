export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface DesktopViewport { stage: Size; content: Size & Point }
export interface DesktopPanState { offset: Point; point: Point; panelAnchorY?: number }
export const MOUSE_SIZE = { width: 120, height: 136 };
export const MOUSE_PANEL_SIZE = MOUSE_SIZE;
export const MOUSE_ICON_SIZE = { width: 40, height: 40 };
export const CURSOR_SIZE = { width: 18, height: 24 };
const PANEL_GAP = CURSOR_SIZE.width + 6;
const EDGE_GAP = 8;
const BOTTOM_EDGE_PAN_GAIN = 2;
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

/** The panel stays to the right of the pointer; the viewport pans instead of reflowing controls. */
export function mousePanelPosition(cursor: Point, stage?: Size, panel?: Size): Point {
  const position = { x: cursor.x + PANEL_GAP, y: cursor.y };
  if (!stage || !panel) return position;
  // During manual zoom the pointer may leave the view; keep its controls reachable without moving the video.
  return { x: clamp(position.x, EDGE_GAP, Math.max(EDGE_GAP, stage.width - panel.width - EDGE_GAP)),
    y: clamp(position.y, EDGE_GAP, Math.max(EDGE_GAP, stage.height - panel.height - EDGE_GAP)) };
}

/** Reveal canvas at the bottom edge and restore it on upward movement, without idle recentering. */
export function panDesktopViewport(viewport: DesktopViewport, point: Point, panel: Size, previous?: DesktopPanState) {
  const offset = previous?.offset ?? { x: 0, y: 0 };
  const cursor = cursorPosition(point, viewport);
  const x = clamp(offset.x, EDGE_GAP - cursor.x,
    viewport.stage.width - EDGE_GAP - cursor.x - PANEL_GAP - panel.width);
  const panelBottom = viewport.stage.height - EDGE_GAP - Math.max(CURSOR_SIZE.height, panel.height);
  // A collapsed icon must finish the same pan before adopting its smaller edge inset.
  const bottom = Math.min(panelBottom, previous?.panelAnchorY ?? panelBottom);
  const bottomLimit = bottom - cursor.y;
  const endLimit = bottom - cursorPosition({ x: point.x, y: 1 }, viewport).y;
  // The pad leaves little room to swipe downward at the bottom. Reveal its black margin faster,
  // capped at the space needed when the pointer reaches the desktop's last row.
  const deltaY = (point.y - (previous?.point.y ?? point.y)) * Math.max(0, viewport.content.height - 1);
  const movingDown = !previous || deltaY > 0;
  const assistedLimit = movingDown && bottomLimit < 0
    ? Math.max(bottomLimit * BOTTOM_EDGE_PAN_GAIN, endLimit) : bottomLimit;
  const downwardLimit = previous && movingDown
    ? Math.max(assistedLimit, offset.y - deltaY * BOTTOM_EDGE_PAN_GAIN) : assistedLimit;
  // Reverse immediately at the same gain, but keep the panel visible and stop at the fitted position.
  const restoredY = offset.y < 0
    ? Math.min(0, offset.y + Math.max(0, -deltaY) * BOTTOM_EDGE_PAN_GAIN) : offset.y;
  const y = clamp(restoredY, EDGE_GAP - cursor.y, Math.min(bottomLimit, downwardLimit));
  // Once bottom assistance starts, anchor the controls to the video so both move at the same speed.
  // Retain the anchor on idle collapse; the cursor still tracks the actual remote click target.
  const panelAnchorY = y < 0 ? Math.min(previous?.panelAnchorY ?? bottom, bottom) : undefined;
  const panelPosition = mousePanelPosition({ x: cursor.x + x,
    y: Math.min(cursor.y, panelAnchorY ?? cursor.y) + y }, viewport.stage, panel);
  return { point, offset: { x, y }, panelAnchorY, panelPosition, viewport: { ...viewport,
    content: { ...viewport.content, x: viewport.content.x + x, y: viewport.content.y + y } } };
}
