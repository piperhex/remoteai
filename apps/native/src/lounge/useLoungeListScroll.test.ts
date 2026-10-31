import { beforeEach, expect, it, vi } from 'vitest';
import type { FlatList } from 'react-native';
import type { LoungeMessage } from '../../../../shared/lounge/types';
import type { MobileLounge } from '../../../../shared/lounge/useMobileLounge';
import { useLoungeListScroll } from './useLoungeListScroll';

const refs = vi.hoisted(() => ({ current: { key: '', offset: null as number | null } }));
vi.mock('react', () => ({ useRef: () => refs }));
const scrollToOffset = vi.fn();
const list = { current: { scrollToOffset } as unknown as FlatList<LoungeMessage> };
const updateScrollPosition = vi.fn();
const reveal = vi.fn();
let model: MobileLounge;
const render = () => useLoungeListScroll({ list, model, reveal });
const event = (offset: number) => ({ nativeEvent: { contentOffset: { y: offset },
  layoutMeasurement: { height: 600 } } } as Parameters<ReturnType<typeof render>['onScroll']>[0]);

beforeEach(() => {
  refs.current = { key: '', offset: null };
  vi.clearAllMocks();
  model = { chats: false, state: { conversation: 'bob' }, atBottom: false, following: false,
    offsets: { current: new Map([['bob', 900]]) }, navigation: {}, updateScrollPosition, latest: vi.fn(),
  } as unknown as MobileLounge;
});

it('ignores clamped mount events until the virtualized list restores the saved position', () => {
  const scroll = render();
  scroll.onScroll(event(0));
  scroll.onContentSizeChange();
  expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 900, animated: false });
  scroll.onScroll(event(350));
  expect(updateScrollPosition).not.toHaveBeenCalled();
  scroll.onContentSizeChange();
  expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 900, animated: false });
  scroll.onScroll(event(900));
  expect(updateScrollPosition).toHaveBeenLastCalledWith(900, 600);
  scrollToOffset.mockClear(); scroll.onContentSizeChange();
  expect(scrollToOffset).not.toHaveBeenCalled();
});

it('lets a reader cancel restoration and returns directly to the latest message on request', () => {
  const scroll = render();
  scroll.onScrollBeginDrag(); scroll.onScroll(event(300));
  expect(updateScrollPosition).toHaveBeenLastCalledWith(300, 600);
  scroll.latest();
  expect(model.latest).toHaveBeenCalledOnce();
  expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: true });
});

it('follows content growth only at the bottom and keeps history focus available', () => {
  model.atBottom = true;
  model.following = true;
  model.offsets.current.clear();
  render().onContentSizeChange();
  expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  scrollToOffset.mockClear();
  model.atBottom = false; model.navigation.highlight = 'original';
  model.following = false;
  render().onContentSizeChange();
  expect(reveal).toHaveBeenCalledOnce();
  expect(scrollToOffset).not.toHaveBeenCalled();
});

it('never competes with dragging or momentum when images and list measurements arrive', () => {
  model.atBottom = true;
  model.following = true;
  model.offsets.current.clear();
  const scroll = render();
  scroll.onScrollBeginDrag();
  scroll.onContentSizeChange(); scroll.follow();
  scroll.onLayout({ nativeEvent: { layout: { height: 600 } } } as Parameters<typeof scroll.onLayout>[0]);
  expect(scrollToOffset).not.toHaveBeenCalled();
  scroll.onScroll(event(20));
  scroll.onScrollEndDrag(event(20));
  scroll.onContentSizeChange(); scroll.follow();
  expect(scrollToOffset).not.toHaveBeenCalled();
  scroll.onScrollBeginDrag(); scroll.onScroll(event(0)); scroll.follow();
  expect(scrollToOffset).not.toHaveBeenCalled();
  scroll.onScrollEndDrag(event(0)); scroll.follow();
  expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
});

it('restores small manual offsets even inside the read-receipt proximity threshold', () => {
  model.atBottom = true;
  model.following = true;
  model.offsets.current.set('bob', 20);
  const scroll = render();
  scroll.onContentSizeChange();
  expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 20, animated: false });
  scroll.onScroll(event(20)); scrollToOffset.mockClear();
  scroll.onContentSizeChange(); scroll.follow();
  expect(scrollToOffset).not.toHaveBeenCalled();
  scroll.latest(); scroll.onScroll(event(0)); scroll.onContentSizeChange();
  expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
});
