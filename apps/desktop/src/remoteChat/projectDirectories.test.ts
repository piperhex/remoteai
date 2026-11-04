// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../../../../shared/conversation/api';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));

it('forwards folder browsing to the typed desktop boundary and keeps failures scoped to the request', async () => {
  const body = { operation: 'projectDirectories', directory: 'F:/projects' };
  const data = { directory: 'F:/projects', parent: 'F:/', entries: [], truncated: false };
  vi.mocked(guiApi.request).mockRejectedValueOnce('暂时无法读取文件夹。').mockResolvedValueOnce(data);
  const operations = new ChatOperations();
  expect(await operations.execute({ kind: 'request', method: 'request', id: 'failed', body }))
    .toMatchObject({ error: '暂时无法读取文件夹。' });
  expect(await operations.execute({ kind: 'request', method: 'request', id: 'retry', body })).toMatchObject({ data });
  expect(guiApi.request).toHaveBeenLastCalledWith(body);
});
