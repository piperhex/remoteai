import { expect, type Locator, type Page } from '@playwright/test';

type Capture = (state: string) => Promise<void>;

async function holdProfile(page: Page, row: Locator) {
  const bounds = await row.boundingBox();
  if (!bounds) throw new Error('SSH profile is not visible');
  const client = await page.context().newCDPSession(page);
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  try {
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await expect(page.getByRole('menuitem', { name: '移除' })).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await client.detach();
  }
}

export async function checkProfileActions(page: Page, workspace: Locator, capture: Capture) {
  const sidebar = workspace.locator('.sshw-profiles');
  await sidebar.getByRole('textbox').fill('');
  const create = sidebar.getByRole('button', { name: '新建 SSH 连接' });
  const search = await sidebar.getByRole('textbox').boundingBox();
  const plus = await create.boundingBox();
  expect(plus!.x).toBeGreaterThan(search!.x + search!.width);
  await create.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.ssh-dialog-title')).toHaveText('新建 SSH 连接');
  await expect(dialog.getByLabel('IP 或主机名', { exact: true })).toHaveValue('');
  await capture('sidebar-create');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const build = sidebar.getByRole('button', { name: /构建服务器/ });
  await build.click({ button: 'right' });
  await expect(page.getByRole('menuitem')).toHaveText(['编辑', '移除']);
  await capture('profile-menu');
  await page.getByRole('menuitem', { name: '编辑' }).click();
  await expect(dialog.getByLabel('IP 或主机名', { exact: true })).toHaveValue('build.example.test');
  const name = dialog.getByLabel('连接名称（可选）', { exact: true });
  await name.fill('构建服务器 2');
  await capture('profile-edit');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(build).toContainText('构建服务器 2');
  await holdProfile(page, build);
  await expect(page.getByRole('menuitem')).toHaveText(['编辑', '移除']);
  await capture('profile-long-press');
  await page.getByRole('menuitem', { name: '移除' }).click();
  await expect(dialog).toContainText('构建服务器 2');
  await capture('profile-remove');
  await dialog.getByRole('button', { name: '取消' }).click();
  await build.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移除' }).click();
  await dialog.getByRole('button', { name: '移除' }).click();
  await expect(build).toHaveCount(0);
  await expect(workspace.getByRole('tab')).toHaveCount(1);
}

export async function expectCenteredProfileIcons(profile: Locator) {
  const label = (await profile.locator('.sshw-session-label').boundingBox())!;
  const icons = profile.locator('svg');
  await expect(icons).toHaveCount(2);
  for (const icon of await icons.all()) {
    const box = (await icon.boundingBox())!;
    expect(Math.abs(box.y + box.height / 2 - (label.y + label.height / 2))).toBeLessThan(1);
  }
}

export async function checkSessionMenu(page: Page, workspace: Locator, capture: Capture, computer: string) {
  const trigger = workspace.getByRole('button', { name: '终端连接选项' });
  const items = page.getByRole('menuitem');
  await trigger.click();
  await expect(items).toHaveCount(3);
  await expect(items.first()).toHaveText('新建 SSH 连接');
  await expect(items.nth(1)).toContainText('开发服务器');
  await expect(items.nth(2)).toContainText('备份服务器');
  const profile = page.getByRole('menuitem', { name: /开发服务器/ });
  await capture('session-menu');
  await expectCenteredProfileIcons(profile);
  await items.first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.ssh-dialog-title')).toHaveText('新建 SSH 连接');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await trigger.click();
  await profile.click();
  await expect(profile).toHaveAttribute('aria-expanded', 'true');
  const host = page.getByRole('menuitem', { name: new RegExp(computer) });
  await expect(host).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Offline PC/ })).toBeDisabled();
  await host.click({ trial: true });
  const bounds = (await profile.boundingBox())!;
  const submenu = (await host.locator('..').boundingBox())!;
  const viewport = page.viewportSize()!;
  if (viewport.width - bounds.x - bounds.width >= submenu.width + 4) {
    expect(submenu.x).toBeGreaterThanOrEqual(bounds.x + bounds.width - 1);
  } else {
    expect(submenu.x + submenu.width).toBeLessThanOrEqual(bounds.x + 1);
  }
  await expect(host).toBeInViewport({ ratio: 1 });
  await capture('session-computers');
  await host.click();
  await expect(workspace.getByRole('tab')).toHaveCount(2);
  await expect(workspace.locator('.xterm-rows:visible')).toContainText('wsl-ssh>');
  await workspace.getByRole('button', { name: '关闭终端 2', exact: true }).click();
  await expect(workspace.getByRole('tab')).toHaveCount(1);
}
