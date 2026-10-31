import { useRef, type RefObject } from 'react';
import type { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { LOUNGE_SCROLL_EDGE_TOLERANCE, type MobileLounge } from '../../../../shared/lounge/useMobileLounge';
import type { LoungeMessage } from '../../../../shared/lounge/types';

const RESTORE_TOLERANCE = 1;
interface ScrollPosition {
  key: string;
  offset: number | null;
  reading: boolean;
  interacting: boolean;
}

function initialPosition(model: MobileLounge, key: string): ScrollPosition {
  const saved = model.navigation.focus ? 0 : model.offsets.current.get(model.state.conversation) ?? 0;
  const reading = saved > LOUNGE_SCROLL_EDGE_TOLERANCE;
  return { key, offset: reading ? saved : null, reading, interacting: false };
}

/** Keep the saved offset until virtualized rows can actually restore it. */
export function useLoungeListScroll({ list, model, reveal }: {
  list: RefObject<FlatList<LoungeMessage> | null>; model: MobileLounge; reveal: () => void;
}) {
  const key = `${model.chats}:${model.state.conversation}`;
  const restore = useRef<ScrollPosition>(initialPosition(model, key));
  if (restore.current.key !== key) {
    restore.current = initialPosition(model, key);
  }
  const restorePosition = () => {
    if (model.navigation.focus) restore.current.offset = null;
    const offset = restore.current.offset;
    if (offset === null) return false;
    list.current?.scrollToOffset({ offset, animated: false });
    return true;
  };
  const follow = () => {
    if (restore.current.interacting || restorePosition()) return;
    // Read-receipt proximity is wider than the scroll edge; a small manual scroll must stay put.
    if (model.following && !restore.current.reading) list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const onContentSizeChange = () => {
    if (restore.current.interacting) return;
    if (model.navigation.highlight) reveal();
    else follow();
  };
  const onLayout = ({ nativeEvent: event }: LayoutChangeEvent) => {
    const offset = restore.current.offset ?? model.offsets.current.get(model.state.conversation) ?? 0;
    if (!model.navigation.focus && !restore.current.interacting) {
      list.current?.scrollToOffset({ offset, animated: false });
    }
    model.updateScrollPosition(offset, event.layout.height);
  };
  const onScroll = ({ nativeEvent: event }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const pending = restore.current.offset;
    if (pending !== null && Math.abs(event.contentOffset.y - pending) > RESTORE_TOLERANCE) return;
    restore.current.offset = null;
    restore.current.reading = event.contentOffset.y > LOUNGE_SCROLL_EDGE_TOLERANCE;
    model.updateScrollPosition(event.contentOffset.y, event.layoutMeasurement.height);
  };
  const onScrollBeginDrag = () => { restore.current.offset = null; restore.current.interacting = true; };
  const onScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScroll(event);
    restore.current.interacting = false;
  };
  const latest = () => {
    restore.current.offset = null;
    restore.current.reading = false;
    restore.current.interacting = false;
    model.latest(); list.current?.scrollToOffset({ offset: 0, animated: true });
  };
  return { follow, onContentSizeChange, onLayout, onScroll, onScrollBeginDrag, onScrollEndDrag, latest };
}
