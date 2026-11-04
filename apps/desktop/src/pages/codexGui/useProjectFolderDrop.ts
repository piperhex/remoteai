import { useEffect, useRef, useState, type RefObject } from 'react';
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview';
import { isDesktopApp } from '../../api/backend';
import { uiText } from "../../../../../shared/localization/uiText";
import { guiApi } from '../../../../../shared/conversation/api';
import { droppedReferences } from './fileDrop';

interface Options {
  target: RefObject<HTMLElement>;
  enabled: boolean;
  allowFileAttachments?: boolean;
  onFolder: (path: string) => void;
  onError: (error: unknown) => void;
}

function containsDrop(target: HTMLElement | null, position: { x: number; y: number }) {
  if (!target) return false;
  // Native drag positions use physical pixels; DOM bounds use CSS pixels.
  const bounds = target.getBoundingClientRect();
  const x = position.x / window.devicePixelRatio;
  const y = position.y / window.devicePixelRatio;
  const hovered = document.elementFromPoint?.(x, y);
  return bounds.width > 0 && bounds.height > 0
    && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
    && (!hovered || target.contains(hovered));
}

/** Accept local folders only, within the active new-project surface. */
export function useProjectFolderDrop(options: Options) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const { target, enabled } = options;
  useEffect(() => {
    setDragging(false);
    setReading(false);
    if (!isDesktopApp || !enabled) return;
    let disposed = false;
    let pending = false;
    let unlisten: (() => void) | undefined;
    const accept = async (paths: string[]) => {
      if (pending) return;
      pending = true;
      setReading(true);
      try {
        if (callbacks.current.allowFileAttachments) {
          const references = await droppedReferences(paths);
          if (disposed || !callbacks.current.enabled) return;
          paths = references.filter(reference => reference.kind === 'folder').map(reference => reference.path);
          if (!paths.length) return;
        }
        if (paths.length !== 1 || !paths[0]?.trim()) {
          callbacks.current.onError(new Error(uiText("client.composer.pleaseDropOneFolderAtATime")));
          return;
        }
        // Reuse the host's asynchronous directory validation; regular files are rejected.
        const result = await guiApi.request<{ directory: string }>({
          operation: 'projectDirectories', directory: paths[0],
        });
        if (!disposed && callbacks.current.enabled) callbacks.current.onFolder(result.directory);
      } catch {
        if (!disposed && callbacks.current.enabled) callbacks.current.onError(
          new Error(uiText("client.composer.thisFolderIsUnavailablePleaseChooseAnAccessibleFolder")));
      } finally {
        pending = false;
        if (!disposed) setReading(false);
      }
    };
    const receive = (event: { payload: DragDropEvent }) => {
      if (disposed || !callbacks.current.enabled) return;
      const payload = event.payload;
      if (payload.type === 'leave') { setDragging(false); return; }
      const inside = containsDrop(target.current, payload.position);
      setDragging(payload.type !== 'drop' && inside && !pending);
      if (payload.type === 'drop' && inside) void accept(payload.paths);
    };
    void getCurrentWebview().onDragDropEvent(receive).then(cleanup => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch(() => {
      if (!disposed) callbacks.current.onError(new Error(uiText("client.composer.dragAndDropIsUnavailableClickToChooseAFolder")));
    });
    return () => { disposed = true; unlisten?.(); };
  }, [enabled, target]);
  return { dragging, reading };
}
