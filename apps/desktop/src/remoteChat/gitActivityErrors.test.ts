// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { createErrorFormatter } from '@remoteai/i18n/errors';
import { resources } from '@remoteai/i18n/client';
import { invoke } from '../api/backend';
import { localGitClient } from '../pages/codexGui/localGitClient';
import { ChatOperations } from './operations';
import { createGuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import type { GitFileActionRequest } from '../../../../shared/remote-chat/gitTypes';

vi.mock('../api/backend', () => ({ isDesktopApp: true, invoke: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
const format = createErrorFormatter(resources);
const details = '发布任务 (task-release) → src/app.ts';
const error = JSON.stringify({ code: 'client.gitActivity.filesBusy', params: { details } });
const request: GitFileActionRequest = {
  cwd: '/project', head: 'head', action: 'rollback', files: [{ path: 'src/app.ts', version: 'version' }],
};

beforeEach(() => { vi.resetAllMocks(); vi.mocked(invoke).mockRejectedValue(error); });

it.each(['local', 'direct', 'relay'] as const)('preserves task and file errors through %s transport', async mode => {
  const operations = new ChatOperations();
  const remote = createGuiToolsClient(async <T>(body: object) => {
    const response = await operations.execute({ kind: 'request', id: 'file-action', method: 'request', body },
      mode === 'local' ? 'relay' : mode, 'account');
    if (response.error) throw new Error(response.error);
    return response.data as T;
  });
  const client = mode === 'local' ? localGitClient : remote.git;
  const received: unknown = await client.fileAction(request).catch((error: unknown) => error);
  for (const language of ['zh', 'en', 'ru', 'ja'] as const) {
    expect(format(language, received)).toContain(details);
    expect(format(language, received)).not.toContain('client.gitActivity');
  }
  expect(invoke).toHaveBeenCalledExactlyOnceWith('codex_gui_git_tool', {
    request: { ...request, operation: 'fileAction' },
  });
});
