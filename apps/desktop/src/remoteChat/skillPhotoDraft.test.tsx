// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatDraft } from '../../../../shared/remote-chat/client/useChatDraft';

const skill = { name: 'review', path: '/skills/review/SKILL.md', description: '检查代码', enabled: true };
const images = ['data:image/jpeg;base64,aW1hZ2U='];
let root: Root;
let container: HTMLDivElement;
let draft: ReturnType<typeof useChatDraft>;
let options: Parameters<typeof useChatDraft>[0];
function Harness() { draft = useChatDraft(options); return null; }
async function render(patch: Partial<typeof options> = {}) {
  options = { ...options, ...patch };
  await act(async () => root.render(<Harness />));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); root = createRoot(container);
  options = { threadId: null, sending: false, disabled: false,
    selection: { model: 'astra', effort: 'high', access: 'workspace-write' }, send: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('appends dictation to the latest draft without dropping photos, attachments or skill mentions', async () => {
  const attachments = [{ kind: 'file' as const, name: 'note.txt', path: '/project/note.txt' }];
  const send = vi.fn().mockResolvedValue(true);
  await render({ threadId: 'chat', send });
  await act(async () => draft.restore({ text: '$review', images, attachments, skills: [skill] }));
  await act(async () => { draft.setText('$review 补充'); draft.appendDictation('  语音内容  '); });
  expect(draft.text).toBe('$review 补充\n语音内容');
  await act(async () => { await draft.submit(); });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: '$review 补充\n语音内容', images, attachments,
    skills: [{ name: skill.name, path: skill.path }] }));
});

it('restores full queued text, photos, attachments and editable skills and preserves them on failure', async () => {
  const attachments = [{ kind: 'file' as const, name: 'note.txt', path: '/project/note.txt' }];
  const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  await render({ threadId: 'chat', send });
  const text = '完整内容'.repeat(400) + ' $review';
  await act(async () => draft.restore({ text, images, attachments, skills: [skill] }));
  expect(draft.text).toBe(text);
  expect(draft.images.map((image) => image.url)).toEqual(images);
  expect(draft.references).toEqual(attachments);
  await act(async () => draft.setText(draft.text + ' 修改后'));
  await act(async () => { expect(await draft.submit()).toBe(false); });
  expect(draft.hasContent).toBe(true);
  await act(async () => { expect(await draft.submit()).toBe(true); });
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ text: text + ' 修改后', images, attachments,
    skills: [{ name: skill.name, path: skill.path }] }));
  expect(draft.hasContent).toBe(false);
});

it('retains skill references after a failed first photo send and clears them only after a successful retry', async () => {
  let finish!: (sent: boolean) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }))
    .mockResolvedValue(true);
  await render({ send });
  await act(async () => draft.insertSkill({ start: 0, end: 0 }, skill));
  let pending!: Promise<boolean>;
  await act(async () => { pending = draft.submit({ images }); });
  await render({ threadId: 'created', sending: true });
  await act(async () => finish(false));
  expect(await pending).toBe(false);
  expect(draft.text).toContain('$review');
  await render({ sending: false });
  await act(async () => { expect(await draft.submit({ images })).toBe(true); });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ images,
    skills: [{ name: skill.name, path: skill.path }], text: expect.stringContaining('$review') }));
  expect(draft.text).toBe('');
});

it('sends native photo-only input and does not erase a different chat draft after a late acknowledgement', async () => {
  let finish!: (sent: boolean) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  await render({ threadId: 'first', send });
  let pending!: Promise<boolean>;
  await act(async () => { pending = draft.submit({ images }); });
  expect(send).toHaveBeenCalledWith({ text: '', images, ...options.selection });
  await render({ threadId: 'second' });
  await act(async () => draft.setText('另一条消息'));
  await act(async () => finish(true));
  expect(await pending).toBe(false);
  expect(draft.text).toBe('另一条消息');
});

it('sends an attachment-only first message and preserves text and attachments on retry', async () => {
  const attachments = [{ kind: 'file' as const, name: 'note.txt', path: '', data: 'aGVsbG8=' }];
  const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  await render({ send });
  await act(async () => { expect(await draft.submit({ attachments })).toBe(false); });
  await act(async () => { expect(await draft.submit({ attachments })).toBe(true); });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenNthCalledWith(1, { text: '', images: [], attachments, ...options.selection });
  expect(send).toHaveBeenNthCalledWith(2, { text: '', images: [], attachments, ...options.selection });
});

it('recovers edited text and attachments once without overwriting an existing composer draft', async () => {
  const consumeRecovered = vi.fn();
  await render({ threadId: 'chat' });
  await act(async () => draft.setText('keep my draft'));
  const recovered = { text: 'recovered $review', images, skills: [skill],
    attachments: [{ kind: 'file' as const, path: '/project/note.txt', name: 'note.txt' }] };
  await render({ recovered, consumeRecovered, sending: true });
  expect(draft.text).toBe('keep my draft');
  await render({ sending: false });
  expect(draft.text).toBe('keep my draft\n\nrecovered $review');
  expect(draft.images.map(image => image.url)).toEqual(images);
  expect(draft.references).toEqual(recovered.attachments);
  await render({ consumeRecovered: () => consumeRecovered() });
  expect(consumeRecovered).toHaveBeenCalledTimes(1);
  expect(draft.images).toHaveLength(1);
});

it('adds a preview annotation to existing text, photos and references without sending', async () => {
  const attachments = [{ kind: 'file' as const, name: 'note.txt', path: '/project/note.txt' }];
  const edited = 'data:image/png;base64,ZWRpdGVk';
  await render({ threadId: 'chat' });
  await act(async () => draft.restore({ text: '$review 补充', images, attachments, skills: [skill] }));
  await act(async () => draft.addAnnotatedImage(edited));
  expect(draft.text).toBe('$review 补充');
  expect(draft.images.map(image => image.url)).toEqual([...images, edited]);
  expect(draft.references).toEqual(attachments);
  expect(options.send).not.toHaveBeenCalled();
  await act(async () => draft.restore({ text: 'keep', images: Array(8).fill(images[0]), skills: [] }));
  expect(() => draft.addAnnotatedImage(edited)).toThrow();
  expect(draft.text).toBe('keep');
  expect(draft.images).toHaveLength(8);
});
