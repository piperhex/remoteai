import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyNativeSettingsAvatar({ tap, find, screenshot, profile, saves, fail, image, scale }) {
  await tap('设置'); await find('alice@example.test');
  await find('AL'); await tap('修改头像');
  await find('图片会裁剪为 128×128，保存后同步到各设备。');
  await screenshot(`settings-avatar-default-${scale}`); await tap('取消');
  profile(image); await delay(350);
  await screenshot(`settings-avatar-synced-${scale}`);
  await tap('修改头像');
  assert.equal((await find('恢复默认头像')).enabled, 'true');
  await screenshot(`settings-avatar-editor-${scale}`);
  fail(true); await tap('保存'); await find('头像保存失败，请稍后重试。');
  fail(false); await tap('保存'); await find('alice@example.test');
  assert.equal(saves().at(-1), image);
  await tap('修改头像'); await tap('恢复默认头像'); await find('AL'); await tap('保存');
  assert.equal(saves().at(-1), ''); await find('AL');
  await screenshot(`settings-avatar-reset-${scale}`);
  await tap('查看用户信息，alice@example.test'); await find('用户信息'); await tap('关闭用户信息');
  await tap('发现'); await tap('在线交流'); await tap('群聊');
  await tap('添加内容'); await tap('设置头像'); await find('AL');
  assert.equal((await find('恢复默认头像')).enabled, 'false');
  await tap('取消');
  profile(image); await delay(350);
  await tap('返回聊天列表'); await tap('返回发现'); await tap('设置');
  await tap('修改头像'); assert.equal((await find('恢复默认头像')).enabled, 'true');
  await tap('取消');
  console.log(`PASS native settings avatar at font scale ${scale}: edit, save, failure, reset and chat sync`);
}
