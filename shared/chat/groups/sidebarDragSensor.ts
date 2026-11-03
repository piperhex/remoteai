const DRAG_THRESHOLD = 12;
const SCROLL_EDGE = 36;
const SCROLL_STEP = 12;
export interface DragPoint { x: number; y: number }

function consumeClick() {
  const clear = () => {
    document.removeEventListener('click', consume, true);
    document.removeEventListener('pointerdown', clear, true);
  };
  const consume = (event: MouseEvent) => { event.preventDefault(); event.stopImmediatePropagation(); clear(); };
  document.addEventListener('click', consume, true);
  document.addEventListener('pointerdown', clear, true);
  return clear;
}

function scrollAtEdge(element: Element | null, point: DragPoint, root: HTMLElement) {
  for (let parent = element; parent && root.contains(parent); parent = parent?.parentElement ?? null) {
    if (parent.scrollHeight <= parent.clientHeight || !/auto|scroll/.test(getComputedStyle(parent).overflowY)) continue;
    const bounds = parent.getBoundingClientRect();
    const direction = point.y < bounds.top + SCROLL_EDGE ? -1 : Number(point.y > bounds.bottom - SCROLL_EDGE);
    const before = parent.scrollTop;
    parent.scrollTop += direction * SCROLL_STEP;
    return parent.scrollTop !== before;
  }
  return false;
}

interface SensorOptions {
  event: PointerEvent; root: HTMLElement; source: HTMLElement;
  target: (element: Element | null) => HTMLElement | null;
  preview: (point: DragPoint | null, target: HTMLElement | null) => void;
  drop: (target: HTMLElement) => void;
}

/** Pointer dragging also works in Windows WebViews with native file dropping enabled. Touch keeps its long press. */
export class SidebarDragSession {
  private point: DragPoint;
  private dragging = false;
  private target: HTMLElement | null = null;
  private frame = 0;
  private finished = false;
  private clearClick = () => {};

  constructor(private options: SensorOptions) {
    this.point = { x: options.event.clientX, y: options.event.clientY };
    document.addEventListener('pointermove', this.move, true);
    document.addEventListener('pointerup', this.up, true);
    document.addEventListener('pointercancel', this.cancel, true);
    document.addEventListener('keydown', this.key, true);
    document.addEventListener('contextmenu', this.cancel, true);
    window.addEventListener('blur', this.cancel);
  }

  private show = () => {
    const next = this.options.target(document.elementFromPoint(this.point.x, this.point.y));
    if (this.target !== next) {
      this.target?.removeAttribute('data-chat-drop-active');
      next?.setAttribute('data-chat-drop-active', 'true');
      this.target = next;
    }
    this.options.preview(this.point, this.target);
  };

  private scroll = () => {
    if (!this.options.source.isConnected) { this.cancel(); return; }
    const hit = document.elementFromPoint(this.point.x, this.point.y);
    if (scrollAtEdge(hit, this.point, this.options.root)) this.show();
    this.frame = requestAnimationFrame(this.scroll);
  };

  private finish = () => {
    this.finished = true;
    cancelAnimationFrame(this.frame);
    document.removeEventListener('pointermove', this.move, true);
    document.removeEventListener('pointerup', this.up, true);
    document.removeEventListener('pointercancel', this.cancel, true);
    document.removeEventListener('keydown', this.key, true);
    document.removeEventListener('contextmenu', this.cancel, true);
    window.removeEventListener('blur', this.cancel);
    this.options.source.removeAttribute('data-chat-dragging');
    this.target?.removeAttribute('data-chat-drop-active');
    this.options.root.removeAttribute('data-chat-dragging');
    this.options.preview(null, null);
  };

  cancel = () => {
    if (this.finished) return;
    if (this.dragging) this.clearClick = consumeClick();
    this.finish();
  };

  dispose = () => { this.cancel(); this.clearClick(); };

  private move = (event: PointerEvent) => {
    const { event: start, root, source } = this.options;
    if (event.pointerId !== start.pointerId) return;
    if (!event.buttons) { this.cancel(); return; }
    this.point = { x: event.clientX, y: event.clientY };
    if (!this.dragging && Math.hypot(this.point.x - start.clientX, this.point.y - start.clientY) < DRAG_THRESHOLD) return;
    event.preventDefault();
    if (!this.dragging) {
      this.dragging = true;
      source.setAttribute('data-chat-dragging', 'true');
      root.setAttribute('data-chat-dragging', 'true');
      this.frame = requestAnimationFrame(this.scroll);
    }
    this.show();
  };

  private up = (event: PointerEvent) => {
    if (event.pointerId !== this.options.event.pointerId) return;
    if (this.dragging) {
      this.point = { x: event.clientX, y: event.clientY }; this.show();
      this.clearClick = consumeClick();
    }
    const destination = this.dragging ? this.target : null;
    this.finish();
    if (destination) this.options.drop(destination);
  };

  private key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancel(); }
  };
}
