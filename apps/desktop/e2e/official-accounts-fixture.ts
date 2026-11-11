import type { ClaudeAccountRequest, ClaudeAccountSummary, ClaudeLoginStatus } from '../../../shared/accounts/claudeAccounts';
export { setInterfaceLanguage as setFixtureLanguage } from '../../../shared/localization/interfaceLanguage';

export const sampleClaudeAccount: ClaudeAccountSummary = {
  id: `claude_${'a'.repeat(32)}`, email: 'claude@example.test', plan: 'Pro', accountSource: 'claudeCode',
  active: false, usage: { fetchedAt: '2026-11-11T00:00:00Z' },
};
export function createClaudeFixture() {
  let accounts = [structuredClone(sampleClaudeAccount)];
  let pending: ClaudeLoginStatus | undefined;
  const calls: ClaudeAccountRequest[] = [];
  return { calls, request: async <T,>(request: ClaudeAccountRequest): Promise<T> => {
    calls.push(request);
    let result: unknown;
    if (request.action === 'list') result = accounts;
    else if (request.action === 'start') {
      pending = { loginId: `mock-${request.method}`, status: 'waiting',
        authorizationUrl: 'https://claude.com/cai/oauth/authorize?state=mock-state' };
      result = pending;
    } else if (request.action === 'poll') result = pending;
    else if (request.action === 'cancel' && pending) pending.status = 'cancelled';
    else if (request.action === 'submit' && pending) {
      if (request.code !== 'mock-code#mock-state') throw new Error('client.officialAccounts.stateMismatch');
      pending.status = 'complete'; pending.accountId = sampleClaudeAccount.id;
    } else if (request.action === 'activate') accounts = accounts.map(a => ({ ...a, active: a.id === request.id }));
    else if (request.action === 'deactivate') accounts = accounts.map(a => ({ ...a, active: false }));
    else if (request.action === 'delete') accounts = accounts.filter(a => a.id !== request.id);
    return structuredClone(result) as T;
  } };
}
export const claudeFixture = createClaudeFixture();
