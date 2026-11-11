import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

// Only this browser fixture intercepts IPC. Production builds never load this configuration.
export default mergeConfig(base, defineConfig({ cacheDir: '../../.codex-tmp/official-accounts-vite', plugins: [{
  name: 'official-accounts-fixture', enforce: 'pre',
  transform(code, id) {
    const file = id.replaceAll('\\', '/').split('?')[0];
    if (file.endsWith('/shared/platform/localBackend.ts')) return code.replace(
      'if (isDesktopApp) return invokeTauri<T>(command, args);',
      `if (command === 'claude_account_request') {
        const { claudeFixture } = await import('/e2e/official-accounts-fixture.ts');
        return claudeFixture.request(args.request);
      }
      if (isDesktopApp) return invokeTauri<T>(command, args);`);
    if (file.endsWith('/apps/desktop/src/demo.ts')) return code + `
      DEMO_ACCOUNTS.push({ ...DEMO_ACCOUNTS[0], id: 'claude_' + 'a'.repeat(32), accountSource: 'claudeCode',
        email: 'claude@example.test', plan: 'Pro', active: false, official: false, note: '', expiresAt: null,
        autoSwitchEnabled: false,
        localProxyCompatible: false, directSwitchCompatible: true, usage: {} });`;
    if (file.endsWith('/apps/web/src/chat/useChat.ts')) return `
      import { claudeFixture } from '/e2e/official-accounts-fixture.ts';
      const controller = { claudeAccounts: claudeFixture };
      export function useChat() { return { controller, state: { ready: true }, foreground: true }; }`;
    return undefined;
  },
}], optimizeDeps: { force: true }, server: { port: 1498, strictPort: true } }));
