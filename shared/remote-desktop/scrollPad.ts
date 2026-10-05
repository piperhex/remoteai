import { cursorPosition, mousePanelPosition, type DesktopViewport, type Point } from './geometry';

export const SCROLL_PAD_SIZE = 180;
export const SCROLL_PAD_TRAVEL = 60;
export const SCROLL_PAD_INTERVAL = 80;
const DEAD_ZONE = 8;
const WHEEL_STEP = 120;
const EDGE_GAP = 8;
export type DesktopWheel = (delta: number, horizontal?: boolean) => void;
export interface ScrollPadOptions {
  wheel: DesktopWheel; change: (point: Point) => void; close: () => void; horizontal: boolean;
}

export function scrollPadLayout(viewport: DesktopViewport, point: Point) {
  const panel = mousePanelPosition(cursorPosition(point, viewport));
  const size = Math.max(1, Math.min(SCROLL_PAD_SIZE, viewport.stage.width - EDGE_GAP * 2,
    viewport.stage.height - EDGE_GAP * 2));
  return { size,
    x: Math.max(EDGE_GAP, Math.min(viewport.stage.width - size - EDGE_GAP, panel.x + 60 - size / 2)),
    y: Math.max(EDGE_GAP, Math.min(viewport.stage.height - size - EDGE_GAP, panel.y + 32 - size / 2)) };
}

/** A spring-loaded, axis-aligned wheel control. No input survives a cancelled gesture. */
export class ScrollPadController {
  private position: Point = { x: 0, y: 0 };
  private timer?: ReturnType<typeof setInterval>;
  private active = false;
  constructor(private readonly options: ScrollPadOptions) {}
  start(point: Point) {
    this.stop(); this.active = true;
    this.move(point);
    this.timer = setInterval(() => this.tick(), SCROLL_PAD_INTERVAL);
  }
  move(point: Point) {
    if (!this.active || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const horizontal = Math.abs(point.x) > Math.abs(point.y);
    const amount = Math.max(-SCROLL_PAD_TRAVEL, Math.min(SCROLL_PAD_TRAVEL, horizontal ? point.x : point.y));
    const distance = Math.abs(amount) <= DEAD_ZONE || (horizontal && !this.options.horizontal) ? 0 : amount;
    const wasResting = !this.position.x && !this.position.y;
    this.position = horizontal ? { x: distance, y: 0 } : { x: 0, y: distance };
    this.options.change(this.position);
    if (wasResting && distance) this.tick();
  }
  end() {
    const close = this.active;
    this.stop();
    if (close) this.options.close();
  }
  stop() {
    clearInterval(this.timer); this.timer = undefined; this.active = false;
    this.position = { x: 0, y: 0 }; this.options.change(this.position);
  }
  private tick() {
    const { x, y } = this.position;
    const distance = x || -y;
    if (!distance) return;
    const speed = (Math.abs(distance) - DEAD_ZONE) / (SCROLL_PAD_TRAVEL - DEAD_ZONE);
    this.options.wheel(Math.sign(distance) * Math.max(1, Math.round(WHEEL_STEP * speed)), !!x);
  }
}
