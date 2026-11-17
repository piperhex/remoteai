import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: restores separate new-project and existing conversation drafts`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: mode === 'mobile' ? 390 : 1280, height: 900 });
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.route('**/__codex_switch__/api/invoke', async route => {
      const { command, args = {} } = route.request().postDataJSON();
      let result: unknown = {};
      if (command === 'codex_gui_model_settings') result = { threadId: args.threadId ?? null,
        selection: { model: 'gpt-test', effort: 'high' }, revision: 0 };
      if (command === 'codex_gui_queue_read') result = { revision: 0, threads: {} };
      if (command === 'codex_gui_queue_save') result = args.snapshot;
      if (command === 'codex_gui_cli_status') result = { version: '0.162.1' };
      if (command === 'codex_gui_git') result = { cwd: '', branch: null, branches: [], changedFiles: 0 };
      await route.fulfill({ json: { ok: true, result } });
    });
    await page.goto(`/e2e/agent-drafts-harness.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    const input = page.getByRole('textbox', { name: mode === 'local' ? '消息' : '聊天消息', exact: true });
    const targets = ['empty', 'project-a', 'project-b', 'existing'];
    const read = () => mode === 'local' ? input.innerText() : input.inputValue();
    for (const target of targets) {
      await page.getByRole('button', { name: target, exact: true }).click();
      await expect.poll(read).toBe('');
      await input.fill(`尚未发送的草稿：${target}`);
    }
    for (const target of [...targets, ...targets].reverse()) {
      await page.getByRole('button', { name: target, exact: true }).click();
      await expect.poll(read).toBe(`尚未发送的草稿：${target}`);
      await page.screenshot({ path: `../../.codex-tmp/agent-drafts/${mode}-${target}-restored.png` });
    }
  });
}
