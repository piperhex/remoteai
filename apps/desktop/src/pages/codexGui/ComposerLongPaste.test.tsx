// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from './controller';
import { useComposerDraft } from './useComposerDraft';
import { SkillInput } from './SkillInput';
import { ComposerReferences } from './ComposerReferences';
import { readFileBase64 } from '../../../../../shared/chat/fileData';
import { invoke } from '../../api/backend';

vi.mock('../../api/backend', () => ({ invoke: vi.fn(), isDesktopApp: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('../../../../../shared/chat/fileData', () => ({ readFileBase64: vi.fn() }));
let host: HTMLDivElement;
let root: Root;
let controller: GuiController;
let draft: ReturnType<typeof useComposerDraft>;
const text = '你好\n'.repeat(10_000);
const data = Buffer.from(text).toString('base64');
function Fixture({ scope = 'new' }) {
  draft = useComposerDraft(scope, controller);
  return <><SkillInput value={draft.draft} draftKey={scope} cwd="" active connected disabled={false}
    placeholder="消息" onChange={draft.editContent} onPaste={draft.paste}
    onPasteKeyDown={draft.pasteKeyDown} onSend={() => void draft.send()} />
    <ComposerReferences items={draft.draft.attachments ?? []} disabled={false} onRemove={draft.removeAttachment} /></>;
}
const render = (scope = 'new') => act(async () => root.render(<Fixture scope={scope} />));
function paste(content = text) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) =>
    type === 'text/plain' ? content : '', files: [], items: [] } });
  host.querySelector('[role="textbox"]')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(invoke).mockReset().mockResolvedValue([]);
  vi.mocked(readFileBase64).mockReset().mockResolvedValue(data);
  controller = new GuiController();
  vi.spyOn(controller, 'send').mockResolvedValue(true);
  vi.spyOn(controller, 'report');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); controller.dispose();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('keeps existing text out of the attachment, supports consecutive pastes and individual removal', async () => {
  act(() => draft.editText('请分析这些资料'));
  await act(async () => { paste(); paste(); });
  expect(host.querySelector('[role="textbox"]')!.textContent).toBe('请分析这些资料');
  expect(draft.draft.attachments).toHaveLength(2);
  expect(draft.draft.attachments?.every(item => item.data === data && item.path === '')).toBe(true);
  const retained = draft.draft.attachments![1];
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="移除附件："]')!.click());
  expect(draft.draft.attachments).toEqual([retained]);
  vi.mocked(controller.send).mockResolvedValueOnce(false);
  await act(async () => draft.send());
  expect(draft.draft.attachments).toEqual([retained]);
  await act(async () => draft.send());
  expect(controller.send).toHaveBeenLastCalledWith('请分析这些资料', [], [], [retained]);
  expect(draft.draft.attachments).toBeUndefined();
});

it('blocks sending during encoding and keeps the completed file in its original conversation', async () => {
  let finish!: (data: string) => void;
  vi.mocked(readFileBase64).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  act(() => paste());
  expect(draft.reading).toBe(true);
  await act(async () => draft.send());
  expect(controller.send).not.toHaveBeenCalled();
  await render('other');
  act(() => draft.editText('另一条草稿'));
  await act(async () => finish(data));
  expect(draft.draft.attachments).toBeUndefined();
  expect(draft.draft.text).toBe('另一条草稿');
  await render();
  expect(draft.reading).toBe(false);
  expect(draft.draft.attachments?.[0].data).toBe(data);
});

it('reports read failures without inserting huge text and permits another paste', async () => {
  vi.mocked(readFileBase64).mockRejectedValueOnce(new Error('文件无法读取，请重新选择。'));
  await act(async () => paste());
  expect(draft.draft.text).toBe(''); expect(draft.reading).toBe(false);
  expect(controller.report).toHaveBeenCalledWith('文件无法读取，请重新选择。');
  await act(async () => paste());
  expect(draft.draft.attachments).toHaveLength(1);
});

it('reports attachment capacity instead of replacing an earlier pasted file', async () => {
  act(() => draft.addAttachments(Array.from({ length: 32 }, (_, index) =>
    ({ kind: 'file', path: `C:/file-${index}.txt`, name: `file-${index}.txt` }))));
  await act(async () => paste());
  expect(draft.draft.attachments).toHaveLength(32);
  expect(draft.draft.attachments?.every(item => item.data === undefined)).toBe(true);
  expect(controller.report).toHaveBeenCalledWith('每条消息最多添加 32 个附件或对话引用。');
});

it('rejects oversized files before encoding and leaves the existing draft intact', async () => {
  act(() => draft.editText('保留草稿'));
  await act(async () => paste('x'.repeat(2 * 1024 * 1024 + 1)));
  expect(readFileBase64).not.toHaveBeenCalled();
  expect(draft.draft.text).toBe('保留草稿');
  expect(draft.draft.attachments).toBeUndefined();
  expect(draft.reading).toBe(false);
  expect(controller.report).toHaveBeenCalledWith('单个文件不能超过 2 MB，请选择较小的文件。');
});
