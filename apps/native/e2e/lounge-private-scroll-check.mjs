import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

function seedPrivateHistory({ broadcast, incoming, image }) {
  const self = { id: 'alice', account: 'alice@example.test', moderator: true };
  const peer = { id: 'bob', account: 'bob@example.test' };
  let timestamp = Date.now() - 60_000;
  for (let index = 0; index < 45; index++) {
    broadcast({ ...incoming(`早些时候的聊天记录 ${index} ${'中文内容'.repeat(index % 5)}`, [image]),
      recipient: self, receipts: true, sentAt: new Date(timestamp++).toISOString() });
  }
  broadcast({ ...incoming('你好'), recipient: self, receipts: true, sentAt: new Date(timestamp++).toISOString() });
  for (const text of ['怎么回事', '给我发个图片吧', '你好呀', '你给谁发消息']) {
    const message = { ...incoming(text), sender: self, recipient: peer, receipts: true,
      sentAt: new Date(timestamp++).toISOString() };
    broadcast(message);
    broadcast({ type: 'receipt', id: message.id, from: peer.id, to: self.id, status: 'read' });
  }
}

async function assertStill({ nodes, screenshot, scale }) {
  const positions = [];
  for (let index = 0; index < 6; index++) {
    const current = await nodes();
    positions.push(current.find(node => node.text === '你给谁发消息')?.bounds);
    await screenshot(`private-idle-${scale}-${index}`);
    await delay(200);
  }
  console.log(`Private message positions at ${scale}: ${JSON.stringify(positions)}`);
  assert.ok(positions.every(Boolean), 'The latest message must stay visible while idle');
  assert.equal(new Set(positions).size, 1, 'Idle private messages must not oscillate');
  return positions[0];
}

/** Dragging mixed-height private history must keep the reader's position after receipts and image loads. */
export async function verifyNativePrivateScroll(options) {
  const { adb, tap, find, nodes, screenshot, scale } = options;
  seedPrivateHistory(options);
  await tap('与 bob 私聊'); await find('你给谁发消息');
  const initial = (await find('你给谁发消息')).bounds;
  const list = (await nodes()).find(node => node.scrollable === 'true');
  assert.ok(list, 'The private history must be scrollable');
  const [left, top, right, bottom] = [...list.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
  const x = String(Math.round((left + right) / 2));
  const start = Math.round((top + bottom) / 2);
  await adb('shell', 'input', 'swipe', x, String(start), x, String(start + 100), '1500');
  await delay(1500);
  const position = await assertStill(options);
  assert.notEqual(position, initial, 'A small downward drag must move the history away from the bottom');
  await tap('返回聊天列表'); await tap('与 bob 私聊');
  assert.equal((await find('你给谁发消息')).bounds, position, 'Reopening retains the manual reading position');
  await screenshot(`private-reopened-${scale}`);
  for (let swipe = 0; swipe < 3; swipe++) {
    await adb('shell', 'input', 'swipe', x, String(top + 200), x, String(bottom - 200), '800');
  }
  await find('回到最新消息');
  await screenshot(`private-history-${scale}`);
  await tap('回到最新消息');
  assert.equal((await find('你给谁发消息')).bounds, initial, 'The latest shortcut returns to the actual bottom');
  await screenshot(`private-latest-${scale}`);
  await tap('返回聊天列表'); await find('搜索聊天');
  console.log(`PASS private idle scroll stability and navigation at font scale ${scale}`);
}
