// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ComposerBridge } from './composerBridge';
import { GuiController } from './controller';
import { guiApi } from './api';
import { composerLabel, type RequestSpeed } from '../../../../../shared/remote-chat/composer';
import type { Model } from './types';

vi.mock('./api', () => ({ guiApi: { request: vi.fn(), connect: vi.fn(), subscribe: vi.fn() } }));
const models: Model[] = ['first', 'second'].map((model, index) => ({
  id: model, model, displayName: `GPT-${model}`, isDefault: index === 0, defaultReasoningEffort: 'high',
  supportedReasoningEfforts: ['high', 'xhigh'].map((reasoningEffort) => ({ reasoningEffort, description: '' })),
}));
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(guiApi.request).mockResolvedValue({ data: models, nextCursor: null });
});

it('shares the PC catalog and current model, effort and access in both directions', async () => {
  const bridge = new ComposerBridge();
  const controller = new GuiController();
  controller.setModels(models);
  const detach = bridge.attach(controller);
  const changed = vi.fn();
  bridge.subscribe(changed);
  controller.settings({ model: 'second', effort: 'xhigh', access: 'read-only' });
  expect((await bridge.read()).settings).toEqual({ model: 'second', effort: 'xhigh', access: 'read-only' });
  expect(changed).toHaveBeenCalledOnce();
  const selected = await bridge.update({ model: 'first', access: 'danger-full-access' });
  expect(selected.settings).toEqual({ model: 'first', effort: 'high', access: 'danger-full-access' });
  expect(controller.getSnapshot().settings).toMatchObject(selected.settings);
  expect(composerLabel(models, { ...selected.settings, effort: 'xhigh' })).toBe('GPT-first · 极高');
  detach();
  controller.dispose();
});

it('preserves phone settings until the desktop GUI is opened', async () => {
  const bridge = new ComposerBridge();
  await bridge.update({ model: 'second', effort: 'xhigh', access: 'danger-full-access' });
  const controller = new GuiController();
  controller.setModels(models);
  const detach = bridge.attach(controller);
  expect(controller.getSnapshot().settings).toMatchObject({ model: 'second', effort: 'xhigh',
    access: 'danger-full-access' });
  detach();
  controller.dispose();
});

it('keeps the background queue controller on the configured Provider catalog before opening the GUI', async () => {
  const bridge = new ComposerBridge();
  const controller = new GuiController();
  const detach = bridge.attach(controller);
  await controller.setModels(models);
  expect(controller.getSnapshot().models).toEqual(models);
  await bridge.update({ model: 'second', effort: 'xhigh' });
  expect(controller.getSnapshot().settings).toMatchObject({ model: 'second', effort: 'xhigh' });
  detach(); controller.dispose();
});

it('rejects unsupported models, efforts, permissions and unrelated settings', async () => {
  const bridge = new ComposerBridge();
  for (const patch of [{ model: 'unknown' }, { effort: 'extreme' }, { access: 'invalid' }, { cwd: '/private' }]) {
    await expect(bridge.update(patch)).rejects.toThrow();
  }
  for (const access of ['read-only', 'workspace-write', 'danger-full-access']) {
    expect((await bridge.update({ access })).settings.access).toBe(access);
  }
});

it('loads all account model pages when the desktop GUI has not been opened', async () => {
  vi.mocked(guiApi.request).mockResolvedValueOnce({ data: [models[0]], nextCursor: 'next' })
    .mockResolvedValueOnce({ data: [models[1]], nextCursor: null });
  const snapshot = await new ComposerBridge().read();
  expect(snapshot.models).toEqual(models);
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: 'models', cursor: 'next' });
});

it('does not publish an empty catalog over the last phone-only selection', async () => {
  const bridge = new ComposerBridge();
  const previous = await bridge.update({ model: 'second', effort: 'xhigh' });
  const changed = vi.fn();
  const stop = bridge.subscribe(changed);
  vi.mocked(guiApi.request).mockResolvedValue({ data: [], nextCursor: null });
  await expect(bridge.read()).rejects.toThrow('模型列表');
  expect(changed).not.toHaveBeenCalled();
  vi.mocked(guiApi.request).mockResolvedValue({ data: models, nextCursor: null });
  expect(await bridge.read()).toMatchObject({ models: previous.models, settings: previous.settings });
  stop();
});

it('accepts the resolved default when changing to a model without selectable reasoning levels', async () => {
  const bridge = new ComposerBridge();
  vi.mocked(guiApi.request).mockResolvedValue({ data: [
    { ...models[1], supportedReasoningEfforts: [], defaultReasoningEffort: 'none' },
  ], nextCursor: null });
  expect((await bridge.update({ model: 'second', effort: 'none' })).settings.effort).toBe('none');
  await expect(bridge.update({ effort: 'xhigh' })).rejects.toThrow();
});

it('does not replay a detached conversation choice when the GUI attaches again', () => {
  const bridge = new ComposerBridge(); const controller = new GuiController();
  controller.setModels(models);
  const detach = bridge.attach(controller);
  controller.settings({ model: 'second', effort: 'xhigh' });
  detach();
  controller.settings({ model: 'first', effort: 'high' });
  const stop = bridge.attach(controller);
  expect(controller.getSnapshot().settings).toMatchObject({ model: 'first', effort: 'high' });
  stop(); controller.dispose();
});

it('shares host speed changes without persisting speed in the conversation or losing it on model edits', async () => {
  let speed: RequestSpeed = 'normal';
  let notify: (value: RequestSpeed) => void = () => undefined;
  const unsubscribe = vi.fn();
  const source = {
    read: vi.fn(async () => speed),
    set: vi.fn(async (next: RequestSpeed) => { speed = next; notify(next); return next; }),
    subscribe: (listener: typeof notify) => { notify = listener; return unsubscribe; },
  };
  const bridge = new ComposerBridge(source);
  const controller = new GuiController();
  controller.setModels(models);
  const detach = bridge.attach(controller);
  const settings = vi.spyOn(controller, 'settings');
  const changed = vi.fn();
  const stop = bridge.subscribe(changed);
  expect((await bridge.read()).settings.speed).toBe('normal');
  expect((await bridge.update({ speed: 'fast' })).settings.speed).toBe('fast');
  expect(source.set).toHaveBeenCalledWith('fast');
  expect((await bridge.update({ speed: 'ultrafast' })).settings.speed).toBe('ultrafast');
  expect(source.set).toHaveBeenCalledWith('ultrafast');
  expect(settings).not.toHaveBeenCalled();
  controller.settings({ model: 'second', effort: 'xhigh' });
  expect((await bridge.read()).settings).toMatchObject({ model: 'second', effort: 'xhigh', speed: 'ultrafast' });
  expect(controller.getSnapshot().settings).not.toHaveProperty('speed');
  speed = 'normal'; notify(speed);
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({
    settings: expect.objectContaining({ speed: 'normal' }),
  }));
  const count = source.set.mock.calls.length;
  await bridge.update({ speed: 'normal' });
  expect(source.set).toHaveBeenCalledTimes(count);
  stop(); expect(unsubscribe).toHaveBeenCalledOnce();
  detach(); controller.dispose();
});
