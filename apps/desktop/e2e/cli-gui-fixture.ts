import type { CliHistory, CliRequest, CliSession, CliTransport } from '../../../shared/cli-gui/types';

export function createCliGuiFixture(ready = true) {
  const sessions: CliSession[] = (['claude', 'gemini'] as const).map(engine => ({
    id: `${engine}-history`, engine, title: engine === 'claude' ? '检查项目结构' : '整理测试计划',
    cwd: 'F:/projects/remoteai', model: engine === 'claude' ? 'claude-sonnet' : 'gemini-pro',
    updatedAt: '2026-11-10T08:00:00Z', status: 'idle', archived: false, permissions: [],
  }));
  const entries = new Map<string, CliHistory['entries']>();
  for (const session of sessions) entries.set(session.id, [
    { id: '1', first: 1, last: 1, role: 'user', text: session.title },
    { id: '2', first: 2, last: 2, role: 'assistant', text: '已读取项目说明。接下来会检查共享组件和现有测试。' },
  ]);
  const calls: CliRequest[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const request = async (input: CliRequest): Promise<unknown> => {
    calls.push(input);
    if (input.action === 'status') return { status: ready ? 'ready' : 'missing', version: '0.15.4',
      cliVersion: input.engine === 'claude' ? '2.1.42' : '0.32.1' };
    if (input.action === 'catalog') return { status: 'ready',
      models: [{ id: input.engine === 'claude' ? 'claude-sonnet' : 'gemini-pro',
        label: input.engine === 'claude' ? 'Claude Sonnet' : 'Gemini Pro', isDefault: true }],
      modes: [{ id: 'default', label: 'Default' }], defaultMode: 'default' };
    if (input.action === 'list') return sessions.filter(item => item.engine === input.engine
      && item.archived === input.archived);
    if (input.action === 'create') {
      const session: CliSession = { id: `created-${sessions.length}`, engine: input.engine, title: '新的项目任务',
        cwd: input.cwd, model: input.model, updatedAt: new Date().toISOString(), status: 'idle',
        archived: false, permissions: [] };
      sessions.push(session); entries.set(session.id, []); return session;
    }
    if (!('id' in input)) return {};
    const session = sessions.find(item => item.id === input.id && item.engine === input.engine);
    if (!session) throw new Error('client.cliGui.invalidRequest');
    if (input.action === 'read') return { session: structuredClone(session), entries: input.cursor
      ? [{ id: '0', first: 0, last: 0, role: 'assistant', text: '更早的项目讨论已恢复。' }]
      : entries.get(session.id), cursor: { epoch: 'test', seq: input.cursor ? 0 : 1 }, hasOlder: !input.cursor };
    if (input.action === 'send') {
      entries.get(session.id)?.push({ id: '3', first: 3, last: 3, role: 'user', text: input.text },
        { id: '4', first: 4, last: 4, role: 'assistant', text: '已经检查现有代码。需要确认后才能更新项目文件。' });
      session.permissions = [{ id: 'permission-1', title: '更新项目说明', description: 'README.md · 补充本地开发步骤',
        actions: [{ id: 'once:exact', label: '', behavior: 'allow' }, { id: 'deny:exact', label: '', behavior: 'deny' }] }];
    }
    if (input.action === 'approve') session.permissions = [];
    if (input.action === 'archive') session.archived = true;
    notify(); return {};
  };
  const transport: CliTransport = { request: async <T>(input: CliRequest) => await request(input) as T,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { transport, calls };
}
