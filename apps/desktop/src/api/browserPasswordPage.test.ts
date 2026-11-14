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
  dom.window.document.querySelector('input')!.click();
  expect(dom.window.eval(passwordScript({ action: 'takeFocus' }))).toBeNull();
  dom.window.close();
});

it('fills the selected form and rejects expired focus tokens and changed form actions', () => {
  const dom = page(), document = dom.window.document;
  document.body.insertAdjacentHTML('beforeend', '<form><input autocomplete="username"><input type="password"></form>');
  dom.window.eval(passwordScript({ action: 'install' }));
  dom.window.eval("window.__remoteaiLogin.focus={id:'selected',input:document.forms[1].elements[0]}");
  const fill = () => dom.window.eval(passwordScript({ action: 'fill', login, focusId: 'selected' }));
  expect(dom.window.eval(passwordScript({ action: 'fill', login, focusId: 'expired' }))).toBe(false);
  expect(fill()).toBe(true);
  expect((document.forms[0].elements[1] as HTMLInputElement).value).toBe('');
  expect((document.forms[1].elements[1] as HTMLInputElement).value).toBe(login.password);
  document.forms[1].action = 'https://other.test'; expect(fill()).toBe(false);
  document.forms[1].remove(); expect(fill()).toBe(false);
  dom.window.close();
});

it('never fills a new-password field', () => {
  const dom = page();
  dom.window.document.querySelector('input[type=password]')!.setAttribute('autocomplete', 'new-password');
  expect(dom.window.eval(passwordScript({ action: 'fill', login }))).toBe(false);
  dom.window.close();
});
