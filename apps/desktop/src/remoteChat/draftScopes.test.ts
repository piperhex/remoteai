import { expect, it } from 'vitest';
import { DraftScopes } from '../../../../shared/remote-chat/client/draftScopes';
import { ChatController } from '../../../../shared/remote-chat/client/controller';

it('retains a scope per new project and transfers it to the created conversation', () => {
  const scopes = new DraftScopes();
  const empty = scopes.project();
  const project = scopes.project('/project');
  const other = scopes.project('/other');
  expect(new Set([empty, project, other]).size).toBe(3);
  expect(scopes.project()).toBe(empty);
  expect(scopes.project('/project')).toBe(project);
  scopes.created(project, 'created');
  expect(scopes.thread('created')).toBe(project);
  expect(scopes.project('/project')).not.toBe(project);
  expect(scopes.project()).toBe(empty);
  expect(scopes.project('/other')).toBe(other);
  expect(scopes.thread('existing')).toBe('existing');
});

it('uses the same project scopes from new-chat navigation, the picker and worktree selection', async () => {
  const controller = new ChatController(() => ({ start() {}, stop() {}, request: async <T,>() => ({} as T) }));
  Object.assign(controller.snapshot(), { ready: true });
  try {
    const empty = controller.snapshot().draftScope;
    const project = { cwd: '/project', label: 'Project' };
    controller.back(project);
    const scope = controller.snapshot().draftScope;
    controller.back({ cwd: '/other', label: 'Other' });
    expect(controller.snapshot().draftScope).not.toBe(scope);
    controller.chooseDraftProject(project);
    expect(controller.snapshot().draftScope).toBe(scope);
    await controller.selectProject(null);
    expect(controller.snapshot().draftScope).toBe(empty);
    controller.back(project);
    expect(controller.snapshot().draftScope).toBe(scope);
  } finally { controller.stop(); }
});
