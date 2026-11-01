import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

/** Exercises the production native settings against another device's profile updates. */
export async function verifyNativeAvatar(options) {
  const { tap, find, screenshot, restart, profile, saves, fail, image, scale } = options;
  const open = async () => { await tap('添加内容'); await tap('设置头像'); };
  profile(image); await delay(350); await open();
  await find('图片会裁剪为 128×128，保存后同步到各设备。');
  assert.equal((await find('恢复默认头像')).enabled, 'true');
  await screenshot(`avatar-synced-${scale}`);
  fail(true); await tap('保存'); await find('头像保存失败，请稍后重试。');
  await screenshot(`avatar-failed-${scale}`);
  fail(false); const before = saves().length; await tap('保存'); await find('添加内容');
  assert.equal(saves().length, before + 1, 'Native save must reach the server');
  assert.equal(saves().at(-1), image);
  // A fresh install has no avatar cache. The ready frame must still restore the server profile.
  await restart(true); await tap('在线交流'); await tap('群聊'); await open();
  assert.equal((await find('恢复默认头像')).enabled, 'true');
  await screenshot(`avatar-reloaded-${scale}`);
  await tap('恢复默认头像'); await find('AL'); await tap('保存'); await find('添加内容');
  assert.equal(saves().at(-1), '', 'Reset must be persisted as well');
  profile(image); await delay(350); await open();
  assert.equal((await find('恢复默认头像')).enabled, 'true'); await tap('取消');
  profile(''); await delay(350); await open(); await find('AL');
  assert.equal((await find('恢复默认头像')).enabled, 'false');
  await screenshot(`avatar-reset-${scale}`); await tap('取消');
  await restart(false); await tap('在线交流'); await tap('群聊'); await open(); await find('AL');
  assert.equal((await find('恢复默认头像')).enabled, 'false', 'Old device cache must not undo a remote reset');
  await tap('取消'); await tap('返回聊天列表'); await tap('返回发现'); await find('在线交流');
  console.log(`PASS native avatar at font scale ${scale}: save, failure, sync, reset, fresh install and reconnect`);
}
