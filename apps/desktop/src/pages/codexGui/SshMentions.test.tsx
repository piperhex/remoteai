// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SkillInput } from './SkillInput';
import { ComposerReferences } from './ComposerReferences';
import { readEditor } from './skillEditorDom';
import type { ComposerText } from '../../../../../shared/conversation/types';
import type { AttachmentReference } from '../../../../../shared/conversation/attachmentTypes';
import { remoteAttachments } from '../../../../../shared/remote-chat/composerAttachments';
import { composerSshProfiles } from '../../../../../shared/testing/sshProfiles';
import { sshCandidates, sshReference } from '../../../../../shared/conversation/sshReferences';
import { visibleUserContent } from '../../../../../shared/chat/conversationContext';
import { referenceKind } from '../../../../../shared/conversation/conversationReferences';

const profiles = { list: vi.fn() };
const send = vi.fn();
let host: HTMLDivElement;
let root: Root;
function Fixture({ draftKey = 'new' }: { draftKey?: string }) {
  const [value, onChange] = useState<ComposerText>({ text: '', mentions: [] });
  const [items, setItems] = useState<AttachmentReference[]>([]);
  return <><ComposerReferences items={items} disabled={false}
    onRemove={path => setItems(items.filter(item => item.path !== path))} />
    <SkillInput value={value} draftKey={draftKey} cwd="F:/project" active connected disabled={false}
      sshProfiles={profiles} onSsh={item => setItems([...items, item])}
      placeholder="" onChange={onChange} onPaste={() => {}}
      onSend={() => send({ ...value, attachments: items })} /></>;
}
const editor = () => host.querySelector<HTMLDivElement>('[role="textbox"]')!;
async function type(text: string) {
  await act(async () => {
    editor().textContent = text;
    const range = document.createRange();
    range.setStart(editor().firstChild!, text.length); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    editor().dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}
const key = (value: string) => act(async () => {
  editor().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
});
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  profiles.list.mockReset().mockResolvedValue(composerSshProfiles);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('opens ! candidates, filters without refetching and selects a reference without sending', async () => {
  expect(profiles.list).not.toHaveBeenCalled();
  await type('请使用 !');
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(2);
  await type('请使用 !开发');
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(profiles.list).toHaveBeenCalledOnce();
  await key('Tab');
  expect(readEditor(editor()).text).toBe('请使用 ');
  expect(host.textContent).toContain('!开发服务器');
  expect(send).not.toHaveBeenCalled();
  await key('Enter');
  expect(send).toHaveBeenCalledWith({ text: '请使用 ', mentions: [],
    attachments: [sshReference(composerSshProfiles[0])] });
});

it('supports arrow selection, mouse selection, removal and Escape', async () => {
  await type('!'); await key('ArrowDown'); await key('Enter');
  expect(host.textContent).toContain(`!${composerSshProfiles[1].name}`);
  await type('!开发');
  await act(async () => host.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(host.textContent).toContain('!开发服务器');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除附件：开发服务器"]')!.click());
  expect(host.textContent).not.toContain('!开发服务器');
  await type('!'); await key('Escape');
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it('keeps empty or failed menus from submitting and drops late results on a scope change', async () => {
  profiles.list.mockRejectedValueOnce(new Error('secret server error'));
  await type('!'); await key('Enter');
  expect(host.textContent).toContain('无法读取已保存的 SSH 连接');
  expect(host.textContent).not.toContain('secret server error');
  expect(send).not.toHaveBeenCalled();
  await key('Escape');
  let finish!: (value: typeof composerSshProfiles) => void;
  profiles.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await type('!');
  await act(async () => root.render(<Fixture draftKey="other" />));
  await act(async () => finish(composerSshProfiles));
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it('ignores inline exclamations and validates references without retaining secrets', async () => {
  await type('hello!dev');
  expect(profiles.list).not.toHaveBeenCalled();
  const reference = sshReference(composerSshProfiles[0]);
  expect(remoteAttachments([reference])).toEqual([reference]);
  expect(referenceKind(reference.path)).toBe('ssh');
  for (const path of ['ssh-profile://../secret', 'ssh-profile://one?x=1', 'ssh-profile://']) {
    expect(() => remoteAttachments([{ ...reference, path }])).toThrow();
  }
  expect(() => remoteAttachments([{ ...reference, data: 'YQ==' }])).toThrow();
  const unsafeProfile = { ...composerSshProfiles[0], password: 'never expose' };
  const candidates = sshCandidates([unsafeProfile], 'dev');
  expect(JSON.stringify(candidates)).not.toContain('never expose');
  expect(sshCandidates(composerSshProfiles, '192.0.2')).toHaveLength(1);
  const text = '<codex_gui_conversation_context>\n'
    + JSON.stringify({ kind: 'ssh', id: 'development', name: '开发服务器', note: 'private instructions' })
    + '\n</codex_gui_conversation_context>';
  expect(visibleUserContent([{ type: 'text', text }])).toEqual([
    { type: 'mention', name: '开发服务器', path: 'ssh-profile://development' },
  ]);
});

it('shows a translated sign-in instruction when the account is unavailable', async () => {
  profiles.list.mockRejectedValueOnce(new Error('client.ssh.signIn'));
  await type('!');
  expect(host.textContent).toContain('登录');
  expect(host.textContent).not.toContain('client.ssh.signIn');
  await key('Enter'); expect(send).not.toHaveBeenCalled();
});
