import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { passwordScript } from '../../../../shared/browser/data/passwordScript';

const login = { origin: 'https://example.test', username: 'alice', password: 'secret' };
function page(url = login.origin, action = '') {
  const dom = new JSDOM(`<form action="${action}"><input autocomplete="username"><input type="password"></form>`,
    { url, runScripts: 'outside-only' });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', { value: () => [{}] });
  return dom;
}
it('fills only an exact HTTPS origin, uses input events, and never submits the form', () => {
  const dom = page(), input = dom.window.document.querySelector<HTMLInputElement>('input[type=password]')!;
  let events = 0, submitted = false;
  input.addEventListener('input', () => events++);
  dom.window.document.forms[0].addEventListener('submit', () => { submitted = true; });
  expect(dom.window.eval(passwordScript({ action: 'fill', login }))).toBe(true);
  expect(input.value).toBe('secret'); expect(events).toBe(1); expect(submitted).toBe(false);
  dom.window.close();
});
it('rejects cleartext sites, other origins, different ports and cross-origin form destinations', () => {
  for (const [url, action] of [['http://example.test', ''], ['https://evil.test', ''],
    ['https://example.test:8443', ''], [login.origin, 'https://evil.test/login']]) {
    const dom = page(url, action);
    expect(dom.window.eval(passwordScript({ action: 'fill', login }))).toBeFalsy();
    expect(dom.window.document.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    dom.window.close();
  }
});
it('does not capture synthetic submissions or expose previously saved secrets to a page', () => {
  const dom = page();
  dom.window.eval(passwordScript({ action: 'install' }));
  dom.window.document.querySelector<HTMLInputElement>('input[type=password]')!.value = 'input-secret';
  dom.window.document.forms[0].dispatchEvent(new dom.window.Event('submit', { bubbles: true }));
  expect(dom.window.eval(passwordScript({ action: 'take' }))).toBeNull();
  dom.window.close();
});
