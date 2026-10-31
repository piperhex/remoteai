import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

async function verifyOwnMenu({ longPress, sent, find, nodes, screenshot, scale, adb }) {
  await longPress(sent.at(-1).text);
  await find('复制'); await find('引用回复');
  const current = await nodes();
  assert.ok(!current.some(node => ['发起私聊', '屏蔽此人'].includes(node.text)), 'Own messages have only two actions');
  await screenshot(`gestures-own-menu-${scale}`);
  await adb('shell', 'input', 'keyevent', '4');
}

export async function verifyNativeGestures({ adb, tap, find, nodes, screenshot, hideKeyboard, longPress,
  scale, sent, broadcast, incoming }) {
  const avatar = '查看 bob 的资料';
  const message = '长按消息操作';
  broadcast(incoming(message)); await find(message);
  await tap('消息'); await adb('shell', 'input', 'text', 'ab');
  await adb('shell', 'input', 'keyevent', '21');
  await longPress(avatar);
  assert.equal((await find('消息')).text, 'a@bob b');
  assert.ok(!(await nodes()).some(node => node.text === '个人资料'), 'Long press must not also open the profile');
  assert.ok((await adb('shell', 'dumpsys', 'input_method')).includes('mInputShown=true'));
  await screenshot(`gestures-mention-${scale}`);
  await hideKeyboard(); await tap(avatar); await find('个人资料'); await tap('返回');
  await longPress(message);
  for (const label of ['复制', '引用回复', '发起私聊', '屏蔽此人']) await find(label);
  await screenshot(`gestures-menu-${scale}`);
  await tap('引用回复'); await find('取消引用');
  assert.equal((await find('消息')).text, 'a@bob b');
  await hideKeyboard(); await tap('取消引用');
  await tap('添加内容'); await tap('历史记录'); await find('搜索消息或账户');
  await longPress(avatar); await find('消息');
  assert.equal((await find('消息')).text, 'a@bob @bob b');
  await delay(500);
  await hideKeyboard(); await screenshot(`gestures-before-copy-${scale}`);
  await longPress(message); await tap('复制'); await find('消息');
  await tap('消息'); await adb('shell', 'input', 'keyevent', '279');
  assert.ok((await find('消息')).text.includes(message), 'Copy places the original message on the clipboard');
  await tap('发送'); await delay(350);
  assert.ok(sent.at(-1).text.includes('@bob'));
  await hideKeyboard();
  await verifyOwnMenu({ longPress, sent, find, nodes, screenshot, scale, adb });
  await longPress(message); await adb('shell', 'input', 'keyevent', '4');
  await find('聊天');
  await tap('返回聊天列表'); await tap('返回发现'); await find('在线交流');
  console.log(`PASS native avatar mention, profile tap, floating menu, quote, copy, history and back at ${scale}`);
}
