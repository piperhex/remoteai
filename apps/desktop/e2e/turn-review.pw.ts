import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';
import type { Thread } from '../../../shared/conversation/types';

const evidence = resolve('../../.codex-tmp/turn-review-evidence');
const base = '说明.md';
const added = '脚本结果.txt';
const dirty = '个人笔记.txt';
let cwd: string;
let thread: Thread;
const git = (...args: string[]) => execFileSync('git', ['-c', 'core.quotePath=false', ...args],
  { cwd, encoding: 'utf8', windowsHide: true });
test.beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'agenthub-review-'));
  mkdirSync(evidence, { recursive: true });
  git('init', '-q'); git('config', 'core.autocrlf', 'false');
  writeFileSync(join(cwd, base), '草稿\n'); writeFileSync(join(cwd, dirty), '笔记\n');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
  writeFileSync(join(cwd, dirty), '之前的笔记\n');
  writeFileSync(join(cwd, base), '已暂存的草稿\n'); git('add', base);
  writeFileSync(join(cwd, base), '完成说明\n');
  execFileSync(process.platform === 'win32' ? 'py' : 'python3', ['-c', 'import sys,pathlib; pathlib.Path(sys.argv[1]).write_bytes(sys.argv[2].encode())',
    added, '检查完成\n'], { cwd, windowsHide: true });
  thread = { id: 'codex-history', name: '更新项目说明', cwd, preview: '更新说明并生成检查结果',
    updatedAt: Date.now() / 1000, status: { type: 'idle' }, turns: [
      { id: 'edits-01', status: 'completed', reviewCwd: cwd, diff: git('diff', '--', base),
        reviewEdits: [{ id: 'patch', type: 'fileChange', status: 'completed', changes: [
          { path: base, kind: { type: 'update' }, diff: git('diff', '--', base) }] }], items: [
        { id: 'request', type: 'userMessage', content: [{ type: 'text', text: '更新说明并生成检查结果' }] },
        { id: 'answer', type: 'agentMessage', text: '已更新说明并写入检查结果。' }] },
      { id: 'check-02', status: 'completed', reviewCwd: cwd, diff: '', items: [
        { id: 'check', type: 'userMessage', content: [{ type: 'text', text: '再检查一次说明' }] },
        { id: 'done', type: 'agentMessage', text: '检查完成。' }] },
    ] };
});
test.afterAll(() => rmSync(cwd, { recursive: true, force: true }));

function reply(operation: string, input: { cwd?: string; path?: string; scope?: string }) {
  if (operation === 'list') return { data: [{ ...thread, turns: undefined }], nextCursor: null };
  if (['read', 'resume', 'syncHistory'].includes(operation)) return { thread };
  expect(input.cwd).toBe(cwd);
  if (['guiGitRepository', 'repository'].includes(operation)) return { repositories: [{ root: cwd, path: '', available: true }] };
  if (['guiGitChanges', 'changes'].includes(operation)) return { root: cwd, files: git('status', '--porcelain=v1', '-z')
    .split('\0').filter(Boolean).map(row => ({ status: row.slice(0, 2), path: row.slice(3), version: 'fixture' })) };
  const args = input.scope === 'staged' ? ['--cached'] : [];
  return { text: git('diff', ...args, '--', input.path!), truncated: false };
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode} reviews the working directory and preserves the selected turn`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: mode === 'remote' ? 1140 : 1440, height: 900 });
    if (mode === 'local') await nativeShell(page);
    await localBackend(page, true, { threads: [thread] });
    await page.route('**/__review_fixture__', route => {
      const body = JSON.parse(route.request().postData()!);
      return route.fulfill({ json: reply(body.operation, body) });
    });
    await page.route('**/__codex_switch__/api/invoke', route => {
      const { command, args } = route.request().postDataJSON();
      if (command === 'codex_gui_undo') return route.fulfill({ json: { ok: true, result: {
        undone: false, preview: args.request.preview ? { files: [base], conflict: false, version: 'fixture' } : undefined,
      } } });
      return command === 'codex_gui_git_tool' ? route.fulfill({ json: { ok: true,
        result: reply(args.request.operation, args.request) } }) : route.fallback();
    });
    await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native&hub&changeReview${mode === 'remote' ? '&dark&large' : ''}`,
      { waitUntil: 'domcontentloaded' });
    await page.getByText('更新项目说明', { exact: true }).first().click();
    await page.getByRole('button', { name: '查看文件更改', exact: true }).click();
    const panel = page.locator('aside[data-details-panel]:visible');
    await expect(panel.getByText(added, { exact: true })).toBeVisible();
    await expect(panel.getByText(dirty, { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: new RegExp(base) }).click();
    await expect(panel.getByText('完成说明', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(evidence, mode + '-unstaged.png') });
    await panel.getByRole('button', { name: '已暂存', exact: true }).click();
    await expect(panel.getByText(added, { exact: true })).toHaveCount(0);
    await expect(panel.getByText('草稿', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(evidence, mode + '-staged.png') });
    await panel.getByText('本轮修改', { exact: true }).first().click();
    await expect(panel).toContainText('已记录的编辑没有留下差异');
    await expect(panel.getByText(base, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(evidence, mode + '-empty.png') });
    await panel.getByRole('combobox').selectOption('edits-01');
    await expect(panel).toContainText('完成说明');
    await expect(panel.getByText(dirty, { exact: true })).toHaveCount(0);
    await expect(panel.getByText(added, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(evidence, mode + '-turn.png') });
    await page.getByRole('button', { name: '收起文件更改', exact: true }).click();
    await page.getByRole('button', { name: '已记录的编辑没有留下差异。', exact: true }).click();
    await expect(panel).toContainText('check-02');
    await expect(panel.getByRole('combobox')).toHaveCount(0);
    await page.getByRole('button', { name: '收起文件更改', exact: true }).click();
    if (mode === 'local') {
      await page.getByRole('button', { name: '撤销本轮修改', exact: true }).click();
      const preview = page.locator('.ant-popconfirm:visible');
      await expect(preview.getByText(base, { exact: true })).toBeVisible();
      const cancel = preview.getByRole('button', { name: /^取\s*消$/ });
      await cancel.click({ trial: true });
      await page.screenshot({ path: join(evidence, 'local-undo-preview.png') });
      await cancel.click();
    }
    await page.getByRole('button', { name: /在 .*agenthub-review-.* 中新建对话/i }).click();
    const bar = page.locator('[data-project-bar]:visible');
    await expect(bar.getByText(cwd, { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: join(evidence, mode + '-directory.png') });
    const overflow = bar.getByRole('button', { name: '更多项目选项' });
    if (await overflow.isVisible()) await overflow.click();
    await page.getByRole('button', { name: '工作位置', exact: true }).click();
    await page.getByRole('button', { name: /新建.*工作树/ }).click();
    await expect(page.getByRole('dialog').getByText(/未提交的修改会保留在原目录/)).toBeVisible();
    await expect(page.locator('.ant-popover').filter({ hasText: '从当前提交创建独立副本' }).first()).toBeHidden();
    await page.getByRole('dialog').getByRole('textbox').fill('review-example');
    await expect(page.getByRole('dialog')).toHaveCSS('transform', 'none');
    await page.screenshot({ path: join(evidence, mode + '-worktree.png') });
  });
}
