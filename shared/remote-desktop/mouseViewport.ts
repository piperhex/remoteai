import { panDesktopViewport, type DesktopPanState, type DesktopViewport, type Point, type Size } from './geometry';

export interface MouseViewportOptions { base: DesktopViewport; panel?: Size; manual: boolean }

function dimensions(base: DesktopViewport) {
  return [base.stage.width, base.stage.height, base.content.width, base.content.height,
    base.content.x, base.content.y].join(':');
}

export function mouseViewportKey({ base, panel, manual }: MouseViewportOptions) {
  return [dimensions(base), panel?.width, panel?.height, manual].join(':');
}

function sameViewport(left: DesktopViewport | undefined, right: DesktopViewport) {
  return !!left && dimensions(left) === dimensions(right)
    && left.edgePan?.x === right.edgePan?.x && left.edgePan?.y === right.edgePan?.y
    && left.edgePan?.offset.x === right.edgePan?.offset.x && left.edgePan?.offset.y === right.edgePan?.offset.y;
}

/** Advance panning for every input event, including events batched into a single React render. */
export class MouseViewport {
  private options?: MouseViewportOptions;
  private key?: string;
  private pan?: DesktopPanState;
  private snapshot?: DesktopViewport;
  private snapshots = new WeakSet<DesktopViewport>();

  constructor(private readonly point: () => Point, private readonly notify: () => void) {}
  getSnapshot = () => this.snapshot;

  private calculate(options: MouseViewportOptions, point: Point) {
    const previous = this.options && dimensions(this.options.base) === dimensions(options.base) ? this.pan : undefined;
    if (options.panel && !options.manual) return panDesktopViewport(options.base, point, options.panel, previous);
    return { viewport: { stage: options.base.stage, content: options.base.content },
      point, offset: { x: 0, y: 0 }, edge: undefined };
  }

  preview(options: MouseViewportOptions) {
    if (this.snapshot && this.key === mouseViewportKey(options)) return this.snapshot;
    return this.calculate(options, this.point()).viewport;
  }

  configure(options: MouseViewportOptions) {
    const key = mouseViewportKey(options);
    if (this.key === key) return;
    const result = this.calculate(options, this.point());
    this.options = options; this.key = key; this.pan = result;
    this.snapshots = new WeakSet();
    this.snapshot = result.viewport; this.snapshots.add(this.snapshot);
    this.notify();
  }

  update(point: Point) {
    if (!this.options) return;
    const result = this.calculate(this.options, point);
    this.pan = result;
    // Pointer-only moves should not redraw the video, toolbar, stats and settings.
    if (sameViewport(this.snapshot, result.viewport)) return;
    this.snapshot = result.viewport; this.snapshots.add(this.snapshot);
  }

  resolve(viewport: DesktopViewport) {
    return this.snapshot && this.snapshots.has(viewport) ? this.snapshot : viewport;
  }

  clear() {
    this.options = undefined; this.key = undefined; this.pan = undefined; this.snapshot = undefined;
    this.snapshots = new WeakSet();
  }
}
