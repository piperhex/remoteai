import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const messageText = index => `History-${String(index).padStart(3, '0')} · ${index % 2
  ? '好的，稍后一起看看。' : '今天的讨论很有收获，明天继续交流。'}`;

export async function verifyNativeHistory({ tap, find, nodes, adb, screenshot, broadcast, scale, longPress,
  hideKeyboard, image, sent }) {
  for (let index = 0; index < 320; index++) broadcast({ type: 'message', id: `history-${index}`,
    text: messageText(index), images: index === 7 ? [image] : [],
    sender: { id: index % 2 ? 'alice' : 'bob', account: `${index % 2 ? 'alice' : 'bob'}@example.test` },
    sentAt: new Date(Date.now() - (320 - index) * 30 * 60_000).toISOString() });
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') {
      await tap('返回发现'); await tap('Light fixture'); await tap('在线交流');
    }
    await tap('群聊'); await tap('添加内容'); await tap('历史记录');
    await find('搜索消息或账户');
    // The fixture delivers a full archive in one burst; allow its serialized SQLite writes to settle.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await find(messageText(319)); break; }
      catch (error) { if (attempt === 2) throw error; }
    }
    await screenshot(`android-${theme}-font-${scale}-latest`);
    if (theme === 'dark') {
      const size = (await adb('shell', 'wm', 'size')).match(/(\d+)x(\d+)/);
      const x = String(Math.round(Number(size[1]) / 2));
      const top = String(Math.round(Number(size[2]) * 0.25));
      const bottom = String(Math.round(Number(size[2]) * 0.85));
      let oldest = 319;
      for (let batch = 0; batch < 16 && oldest > 100; batch++) {
        for (let swipe = 0; swipe < 4; swipe++) await adb('shell', 'input', 'swipe', x, top, x, bottom, '160');
        const visible = (await nodes()).map(node => /History-(\d+)/.exec(node.text)?.[1]).filter(Boolean).map(Number);
        if (visible.length) oldest = Math.min(...visible);
      }
      assert.ok(oldest <= 100, `Older pages preload beyond the memory window: ${oldest}`);
      await screenshot(`android-${theme}-font-${scale}-older`);
      let latest = 0;
      for (let batch = 0; batch < 16 && latest < 319; batch++) {
        for (let swipe = 0; swipe < 4; swipe++) await adb('shell', 'input', 'swipe', x, bottom, x, top, '160');
        const visible = (await nodes()).map(node => /History-(\d+)/.exec(node.text)?.[1]).filter(Boolean).map(Number);
        if (visible.length) latest = Math.max(...visible);
      }
      await find(messageText(319));
    }
    await tap('搜索消息或账户'); await adb('shell', 'input', 'text', 'History-007');
    await find(messageText(7)); await hideKeyboard();
    await screenshot(`android-${theme}-font-${scale}-search`);
    await longPress(messageText(7)); await find('引用回复'); await adb('shell', 'input', 'keyevent', '4');
    await tap('返回聊天'); await find('消息'); await tap('返回聊天列表');
    await verifyPrivateHistory({ tap, find, adb, screenshot, broadcast, scale, theme, sent, hideKeyboard });
    console.log(`PASS history Android ${theme} font ${scale}: search, navigation and gestures`);
  }
  await delay(200);
}

async function verifyPrivateHistory({ tap, find, adb, screenshot, broadcast, scale, theme, sent, hideKeyboard }) {
  broadcast({ type: 'message', id: crypto.randomUUID(), text: '你好，下午一起讨论一下设计方案？', images: [],
    sender: { id: 'bob', account: 'bob@example.test' }, recipient: { id: 'alice', account: 'alice@example.test' },
    receipts: true, sentAt: new Date().toISOString() });
  await tap('与 bob 私聊'); await tap('消息'); await adb('shell', 'input', 'text', 'History-private-reply');
  await tap('发送'); await hideKeyboard(); await find('对方已收到');
  await tap('添加内容'); await tap('历史记录'); await find('对方已收到');
  broadcast({ type: 'receipt', id: sent.at(-1).id, from: 'bob', to: 'alice', status: 'read' });
  await find('对方已阅读'); await screenshot(`android-${theme}-font-${scale}-private`);
  await tap('返回聊天'); await tap('返回聊天列表');
}
