// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoungeController } from '../../../../shared/lounge/controller';
import { useComposerDraft, type ComposerDraftState } from '../../../../shared/lounge/useComposerDraft';
import { useLoungeDrafts } from '../../../../shared/lounge/useLoungeDrafts';
import type { LoungeSnapshot } from '../../../../shared/lounge/types';
import { quoteMessage } from '../../../../shared/lounge/reply';

let controller: LoungeController;
let state: LoungeSnapshot;
let root: ReturnType<typeof createRoot>;
let editor: ReturnType<typeof useComposerDraft>;
let draftState: ComposerDraftState;
const reply = quoteMessage({ type: 'message', id: 'original', sender: { id: 'bob', account: 'bob' },
  text: 'quoted message', images: [], sentAt: '2026-11-08T00:00:00Z' });

function Editor({ external }: { external: ComposerDraftState }) {
  editor = useComposerDraft(external);
  return null;
}
function Harness() {
  draftState = useLoungeDrafts(controller, state);
  return <Editor key={`${state.user?.id}:${state.conversation}`} external={draftState} />;
}
const render = () => act(() => root.render(<Harness />));
function select(conversation: string) { state = { ...state, conversation }; render(); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  controller = new LoungeController(undefined);
  state = { ...controller.snapshot(), user: { id: 'alice', account: 'alice' } };
  vi.spyOn(controller, 'snapshot').mockImplementation(() => state);
  root = createRoot(document.createElement('div'));
  render();
});
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps independent text, images and quotes through group and private conversation switches', () => {
  act(() => { editor.setText('group draft'); editor.setImages(['group image']); });
  act(() => draftState.change(current => ({ ...current, reply })));
  select('bob'); expect(editor.text).toBe('');
  act(() => editor.setText('bob draft'));
  select('carol'); act(() => editor.setText('carol draft'));
  select('');
  expect(draftState.draft).toEqual({ text: 'group draft', images: ['group image'], reply });
  select('bob'); expect(editor.text).toBe('bob draft'); expect(editor.images).toEqual([]);
  select('carol'); expect(editor.text).toBe('carol draft');
});

it('clears only sent content from its original conversation after the composer remounts', () => {
  act(() => { editor.setText('submitted'); editor.setImages(['sent image']); });
  act(() => draftState.change(current => ({ ...current, reply })));
  const sent = draftState.draft;
  const finish = editor.clearSent;
  select('bob'); act(() => editor.setText('other conversation'));
  select(''); act(() => editor.setText('new group edit'));
  act(() => finish(sent));
  expect(draftState.draft).toEqual({ text: 'new group edit', images: [], reply: undefined });
  select('bob'); expect(editor.text).toBe('other conversation');
});

it('applies late image preparation to its original draft without losing edits made after returning', () => {
  act(() => editor.setText('group draft'));
  const addImages = editor.setImages;
  select('bob'); act(() => editor.setImages(['bob image']));
  select(''); act(() => editor.setText('edited group draft'));
  act(() => addImages(current => [...current, 'prepared image']));
  expect(draftState.draft).toEqual({ text: 'edited group draft', images: ['prepared image'] });
  select('bob'); expect(editor.images).toEqual(['bob image']);
});

it('removes deleted drafts and ignores late updates from before the deletion', () => {
  act(() => editor.setText('group draft'));
  select('bob'); act(() => editor.setText('deleted draft'));
  const stale = editor.setText;
  state = { ...state, conversation: '', deletedConversations: { bob: 1 } }; render();
  expect(editor.text).toBe('group draft');
  act(() => stale('late result'));
  select('bob'); expect(editor.text).toBe('');
  act(() => editor.setText('new conversation draft'));
  select(''); select('bob'); expect(editor.text).toBe('new conversation draft');
});

it('isolates drafts when the account or controller changes and ignores old callbacks', () => {
  act(() => editor.setText('alice draft'));
  const stale = editor.setText;
  state = { ...state, user: { id: 'other', account: 'other' } }; render();
  expect(editor.text).toBe('');
  act(() => { editor.setText('other draft'); stale('late alice edit'); });
  expect(editor.text).toBe('other draft');
  controller = new LoungeController(undefined);
  vi.spyOn(controller, 'snapshot').mockImplementation(() => state);
  render(); expect(editor.text).toBe('');
});
