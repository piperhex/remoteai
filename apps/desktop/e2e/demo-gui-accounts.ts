import type { GuiAccountsSnapshot } from '../../../shared/remote-chat/guiAccounts';

const accounts: GuiAccountsSnapshot = {
  running: true, selection: new URLSearchParams(location.search).has('noGuiAccount')
    ? { kind: 'none' } : { kind: 'account', id: 'first' },
  choices: [
    { kind: 'account', id: 'first', name: '演示账户一', detail: '当前工作账户',
      plan: 'pro', primaryRemainingPercent: 28, available: true },
    { kind: 'account', id: 'second', name: '演示账户二', detail: '备用账户',
      plan: 'Plus', primaryRemainingPercent: 83, available: true },
  ],
};

export function demoGuiAccounts(input: Record<string, unknown>) {
  if (input.operation === 'guiAccountsRead') return accounts;
  const selection = input.selection as { kind?: unknown; id?: unknown } | undefined;
  const choice = accounts.choices.find((entry) => entry.kind === selection?.kind && entry.id === selection?.id);
  if (!choice) throw new Error('Unknown demo account');
  accounts.selection = { kind: choice.kind, id: choice.id };
  return accounts.selection;
}
