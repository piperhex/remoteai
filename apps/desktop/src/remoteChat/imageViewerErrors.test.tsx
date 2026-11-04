import { displayText } from '../../../../shared/localization/uiText';
import { formatRemoteError } from '../../../../shared/localization/errors';
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../../../shared/chat/ImageViewer';


const original = 'data:image/png;base64,b3JpZ2luYWw=';
const russian = (text: string) => displayText(text, {}, 'ru');
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function downloadFailure(failure: unknown) {
  await act(async () => root.render(<ImageViewer thumbnail="thumbnail" description="截图" translate={russian}
    formatError={error => formatRemoteError('ru', error)}
    load={async () => original} close={() => {}} download={async () => { throw failure; }} />));
  await act(async () => container.querySelector<HTMLButtonElement>('.cs-image-download')!.click());
  return container.querySelector('.cs-image-status[role="status"]')?.textContent;
}

it('shows a save failure in the interface language', async () => {
  expect(await downloadFailure(new Error('请重新加载原图后保存。'))).toBe(russian("client.runtimeErrors.reloadTheOriginalImageThenSaveIt"));
  expect(russian("client.runtimeErrors.reloadTheOriginalImageThenSaveIt")).not.toMatch(/[一-鿿]/);
});

it('translates the fallback when a download fails without an error message', async () => {
  expect(await downloadFailure('offline')).toBe(russian("client.shared.downloadFailedPleaseTryAgain"));
  expect(russian("client.shared.downloadFailedPleaseTryAgain")).not.toMatch(/[一-鿿]/);
});

it('leaves an unknown error message unchanged', async () => {
  expect(await downloadFailure(new Error('disk full'))).toBe('disk full');
});
