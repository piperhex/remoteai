import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ArrowRight, Folder, MessageSquare } from 'lucide-react';
import { useGrouping } from './context';
import type { GroupTarget, Grouping } from './model';
import { SidebarDragSession, type DragPoint } from './sidebarDragSensor';
import './sidebarDrag.css';

type Destination = { kind: 'group' | 'project'; id: string };
export interface SidebarDragOptions {
  enabled: boolean;
  threadCwds: Record<string, string>;
  canMoveThread: (id: string) => boolean;
  moveThread: (id: string, cwd: string) => Promise<void>;
}

export function acceptsSidebarDrop(options: {
  source: GroupTarget; destination: Destination; grouping: Grouping;
  threadCwds: Record<string, string>; canMoveThread: (id: string) => boolean;
}) {
  const { source, destination, grouping, threadCwds, canMoveThread } = options;
  if (destination.kind === 'group') return grouping.groups.some(group => group.id === destination.id)
    && grouping[source.kind === 'thread' ? 'threads' : 'projects'][source.id] !== destination.id;
  return source.kind === 'thread' && Boolean(destination.id) && canMoveThread(source.id)
    && (threadCwds[source.id] !== destination.id || Object.hasOwn(grouping.threads, source.id));
}

function destination(element: HTMLElement): Destination | null {
  const kind = element.dataset.chatDropKind;
  const id = element.dataset.chatDropId;
  return (kind === 'group' || kind === 'project') && id ? { kind, id } : null;
}

export function SidebarDrag({ children, options }: { children: ReactNode; options?: SidebarDragOptions }) {
  const groups = useGrouping();
  const root = useRef<HTMLDivElement>(null);
  const session = useRef<SidebarDragSession>();
  const latest = useRef({ groups, options }); latest.current = { groups, options };
  const [preview, setPreview] = useState<{ point: DragPoint; label: string; kind: GroupTarget['kind']; to: string }>();
  const enabled = Boolean(options?.enabled && groups?.ready && !groups.busy);
  useEffect(() => () => session.current?.dispose(), []);
  useEffect(() => { if (!enabled) session.current?.cancel(); }, [enabled]);
  const canDrop = (source: GroupTarget, target: HTMLElement) => {
    const { groups: current, options: config } = latest.current;
    const to = destination(target);
    return Boolean(current?.ready && !current.busy && config?.enabled && to
      && acceptsSidebarDrop({ source, destination: to, grouping: current.grouping, ...config }));
  };
  const drop = async (source: GroupTarget, target: HTMLElement) => {
    if (!canDrop(source, target)) return;
    const to = destination(target)!;
    const current = latest.current;
    if (to.kind === 'group') await current.groups?.assign([source], to.id);
    else await current.groups?.perform(() => current.options!.moveThread(source.id, to.id));
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    session.current?.dispose();
    if (!enabled || event.pointerType !== 'mouse' || event.button !== 0 || !event.isPrimary) return;
    const element = (event.target as Element).closest<HTMLElement>('[data-chat-drag-kind]');
    if (!element || !root.current?.contains(element)) return;
    const kind = element.dataset.chatDragKind;
    const id = element.dataset.chatDragId;
    if ((kind !== 'project' && kind !== 'thread') || !id) return;
    const source: GroupTarget = { kind, id };
    const label = element.textContent?.trim() ?? '';
    session.current = new SidebarDragSession({ event: event.nativeEvent, root: root.current, source: element,
      target: hit => {
        const target = hit?.closest<HTMLElement>('[data-chat-drop-kind]');
        return target && root.current?.contains(target) && canDrop(source, target) ? target : null;
      },
      preview: (point, target) => setPreview(point ? { point, label, kind, to: target?.textContent?.trim() ?? '' }
        : undefined),
      drop: target => { void drop(source, target); },
    });
  };
  return <div ref={root} className="chat-sidebar-drag-scope" onPointerDownCapture={start}
    onDragStart={event => { if (enabled) event.preventDefault(); }}>
    {children}
    {preview && <div className="chat-sidebar-drag-preview" aria-hidden="true"
      style={{ left: Math.min(preview.point.x + 16, window.innerWidth - 300),
        top: Math.min(preview.point.y + 16, window.innerHeight - 80) }}>
      {preview.kind === 'project' ? <Folder size={16} /> : <MessageSquare size={16} />}
      <span>{preview.label}</span>{preview.to && <><ArrowRight size={14} /><span>{preview.to}</span></>}
    </div>}
  </div>;
}
