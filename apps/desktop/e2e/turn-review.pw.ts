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
const archivePaths = ['历史说明.md', 'src/摘要.ts', 'src/审核.ts', 'src/文件.ts', 'src/消息.ts',
  'tests/摘要.ts', 'tests/审核.ts', 'tests/文件.ts', 'tests/消息.ts', '变更记录.md'];
const archiveFiles = archivePaths.map((path, index) => ({
  header: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}`,
  added: index === 0 ? 2 : 1, removed: index === 0 ? 0 : 1,
}));
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
      { id: 'large-03', status: 'completed', reviewCwd: cwd, reviewDeferred: 'net', reviewHasEdits: true, reviewEdits: [],
        items: [{ id: 'earlier', type: 'userMessage', content: [{ type: 'text', text: '整理较长的项目说明' }] }] },
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

test('remote reopens a saved turn from an older host and retries a failed file list', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1536, height: 960 });
  await localBackend(page, true, { threads: [thread] });
  let unavailable = true;
  let legacy = true;
  await page.route('**/__review_fixture__', route => {
    const request = route.request().postDataJSON();
    if (request.operation !== 'savedTurnReview') return route.fulfill({ json: reply(request.operation, request) });
    if (request.file !== undefined) return route.fulfill({ json: reply(request.operation, request) });
    if (unavailable) return route.abort();
    const files = legacy ? archiveFiles.map(({ header }) => ({ header })) : archiveFiles;
    return route.fulfill({ json: { files, next: null } });
  });
  await page.goto('/e2e/cli-gui-harness.html?mode=remote&native&hub&changeReview&skin', { waitUntil: 'domcontentloaded' });
  const select = async () => {
    await page.getByText('更新项目说明', { exact: true }).first().click();
    await page.getByText('整理较长的项目说明', { exact: true }).first().scrollIntoViewIfNeeded();
  };
  await select();
  const card = page.getByRole('region', { name: '本轮修改', exact: true });
  const retry = card.getByRole('button', { name: /^重\s*试$/ });
  await expect(retry).toBeVisible();
  unavailable = false;
  await retry.click();
  const archive = card.filter({ hasText: '历史说明.md' });
  await expect(archive).toContainText('已编辑 10 个文件');
  await expect(archive.locator('li')).toHaveCount(3);
  await expect(archive).not.toContainText('+0');
  await archive.locator('li').first().getByRole('button').click();
  const panel = page.locator('aside[data-details-panel]:visible');
  const file = panel.getByRole('button', { name: /历史说明\.md/ });
  await expect(file).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('10 个文件', { exact: true })).toBeVisible();
  await expect(panel.getByText('已保存的首行', { exact: true })).toBeVisible();
  await expect(panel).not.toContainText('+0');
  legacy = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await select();
  await expect(archive.getByRole('button', { name: /新增 11 行，删除 9 行/ })).toBeVisible();
  await archive.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, 'remote-light-files.png') });
});

function reply(operation: string, input: { cwd?: string; path?: string; scope?: string;
  threadId?: string; turnId?: string; file?: number; offset?: number }) {
  if (operation === 'list') return { data: [{ ...thread, turns: undefined }], nextCursor: null };
  if (['read', 'resume', 'syncHistory'].includes(operation)) return { thread };
  if (operation === 'savedTurnReview') {
    expect([input.threadId, input.turnId]).toEqual([thread.id, 'large-03']);
    if (input.file == null) return input.offset
      ? { files: archiveFiles.slice(input.offset), next: null } : { files: archiveFiles.slice(0, 4), next: 4 };
    const { header } = archiveFiles[input.file];
    if (input.file !== 0) return { text: header + '\n@@ -1 +1 @@\n-旧内容\n+新内容\n', next: null };
    return input.offset ? { text: '+已保存的末行\n', next: null }
      : { text: header + '\n@@ -0,0 +1,2 @@\n+已保存的首行\n', next: 150 };
  }
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
    const bodyReads: number[] = [];
    function read(operation: string, input: Parameters<typeof reply>[1]) {
      if (operation === 'savedTurnReview' && input.file !== undefined) bodyReads.push(input.file);
      return reply(operation, input);
    }
    await page.route('**/__review_fixture__', route => {
      const body = JSON.parse(route.request().postData()!);
      return route.fulfill({ json: read(body.operation, body) });
    });
    await page.route('**/__codex_switch__/api/invoke', route => {
      const { command, args } = route.request().postDataJSON();
      if (command === 'codex_gui_request' && args.request.operation === 'savedTurnReview') {
        return route.fulfill({ json: { ok: true, result: { data: read('savedTurnReview', args.request) } } });
      }
      if (command === 'codex_gui_undo') return route.fulfill({ json: { ok: true, result: {
        undone: false, preview: args.request.preview ? { files: [base], conflict: false, version: 'fixture' } : undefined,
      } } });
      return command === 'codex_gui_git_tool' ? route.fulfill({ json: { ok: true,
        result: reply(args.request.operation, args.request) } }) : route.fallback();
    });
    await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native&hub&changeReview${mode === 'remote' ? '&dark&large' : ''}`,
      { waitUntil: 'domcontentloaded' });
    await page.getByText('更新项目说明', { exact: true }).first().click();
    const card = page.getByRole('region', { name: '本轮修改', exact: true }).filter({ hasText: '历史说明.md' });
    const archivedPrompt = page.getByText('整理较长的项目说明', { exact: true }).first();
    await archivedPrompt.scrollIntoViewIfNeeded();
    await expect(card).toContainText('已编辑 10 个文件');
    await expect(card.getByRole('button', { name: /新增 11 行，删除 9 行/ })).toBeVisible();
    await expect(card.locator('li')).toHaveCount(3);
    await expect(card.locator('li').first()).toContainText('+2−0');
    if (mode !== 'local') await expect(card.getByRole('button', { name: '验收结果' })).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, mode + '-files-collapsed.png') });
    await card.getByRole('button', { name: '再显示 7 个文件' }).click();
    await expect(card.locator('li')).toHaveCount(10);
    expect(bodyReads).toEqual([]);
    await page.screenshot({ path: join(evidence, mode + '-files-expanded.png') });
    await card.locator('li').last().getByRole('button').click();
    const panel = page.locator('aside[data-details-panel]:visible');
    const selected = panel.getByRole('button', { name: /变更记录\.md/ });
    const src = panel.getByRole('region', { name: 'src', exact: true });
    await expect(src.getByRole('button')).toHaveCount(4);
    await expect(src.getByRole('button').first()).toContainText('摘要.ts修改+1−1');
    await expect(panel.getByText('10 个文件', { exact: true })).toBeVisible();
    await expect(panel.getByLabel('新增 11 行，删除 9 行', { exact: true })).toBeVisible();
    await expect(selected).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByText('新内容', { exact: true })).toBeVisible();
    expect(bodyReads).toEqual([9]);
    await selected.click();
    await expect(selected).toHaveAttribute('aria-expanded', 'false');
    await expect(selected).toContainText('修改+1−1');
    await expect(panel.getByText('新内容', { exact: true })).toHaveCount(0);
    await panel.screenshot({ path: join(evidence, mode + '-diff-collapsed.png') });
    await selected.click();
    await expect(panel.getByText('新内容', { exact: true })).toBeVisible();
    await panel.screenshot({ path: join(evidence, mode + '-diff-unified.png') });
    await panel.getByRole('button', { name: '并排', exact: true }).click();
    await expect(panel.getByText('修改前', { exact: true })).toBeVisible();
    await panel.screenshot({ path: join(evidence, mode + '-diff-split.png') });
    await page.screenshot({ path: join(evidence, mode + '-file-selected.png') });
    await page.getByRole('button', { name: '收起文件更改', exact: true }).click();
    if (mode !== 'local') {
      await card.getByRole('button', { name: '验收结果' }).click();
      const review = page.locator('.chat-review-panel:visible');
      await review.getByRole('button', { name: '历史说明.md', exact: true }).click();
      await expect(review.getByRole('button', { name: /第 1 行/ })).toBeVisible();
      await page.screenshot({ path: join(evidence, mode + '-saved-result.png') });
      await page.getByRole('button', { name: '关闭详情抽屉' }).click();
    }
    await page.getByRole('button', { name: '查看文件更改', exact: true }).click();
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
    await panel.getByRole('combobox').selectOption('large-03');
    const archive = panel.getByRole('button', { name: '历史说明.md' });
    await expect(archive).toBeVisible();
    await expect(archive).toHaveAttribute('aria-expanded', 'true');
    await expect(archive.locator('..').getByText('已保存的首行')).toBeVisible();
    await archive.locator('..').getByRole('button', { name: '加载更多' }).click();
    await expect(panel.getByText('已保存的末行')).toBeVisible();
    await page.screenshot({ path: join(evidence, mode + '-archive.png') });
    await page.getByRole('button', { name: '收起文件更改', exact: true }).click();
    await page.getByRole('button', { name: '已记录的编辑没有留下差异。', exact: true }).click();
    await expect(panel).toContainText('check-02');
    await expect(panel.getByRole('combobox')).toHaveCount(0);
    await page.getByRole('button', { name: '收起文件更改', exact: true }).click();
    if (mode === 'local') {
      await page.locator('[data-turn-id="edits-01"]').getByRole('button', { name: '撤销本轮修改', exact: true }).click();
      const preview = page.locator('.ant-popconfirm:visible');
      await expect(preview.getByText(base, { exact: true })).toBeVisible();
      const cancel = preview.getByRole('button', { name: /^取\s*消$/ });
      await cancel.click({ trial: true });
      await page.screenshot({ path: join(evidence, 'local-undo-preview.png') });
      await cancel.click();
    }
    await page.getByRole('button', { name: /在 .*agenthub-review-.* 中新建对话/i }).click();
    const bar = page.locator('[data-project-bar]:visible');
    await expect(bar).toBeVisible();
    await expect(bar).not.toContainText(cwd);
    await page.screenshot({ path: join(evidence, mode + '-location.png') });
    const overflow = bar.getByRole('button', { name: '更多项目选项' });
    if (await overflow.isVisible()) await overflow.click();
    const location = page.getByRole('button', { name: '工作位置', exact: true });
    await expect(location).toHaveText(mode === 'local' ? '本地' : '远程电脑');
    await location.click();
    await expect(page.locator('.ant-popover:visible').getByText(cwd, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /新建.*工作树/ }).click();
    await expect(page.getByRole('dialog').getByText(/未提交的修改会保留在原目录/)).toBeVisible();
    await expect(page.locator('.ant-popover').filter({ hasText: '从当前提交创建独立副本' }).first()).toBeHidden();
    await page.getByRole('dialog').getByRole('textbox').fill('review-example');
    await expect(page.getByRole('dialog')).toHaveCSS('transform', 'none');
    await page.screenshot({ path: join(evidence, mode + '-worktree.png') });
  });
}
