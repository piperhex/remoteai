// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { changedFiles } from '../../../../../shared/conversation/diff';
import { EditedFilesSummary } from '../../../../../shared/conversation/EditedFilesSummary';
import { defaultText } from '../../../../../shared/localization/messages';

it('preserves expansion on content hits while updating status and review callbacks', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const reviewFirst = vi.fn();
  const reviewLatest = vi.fn();
  const changes = () => Array.from({ length: 5 }, (_, index) => ({
    path: `src/${index}.ts`, kind: { type: 'add' }, diff: 'content\n',
  }));
  const first = changedFiles(changes());
  const render = (status: string, onReviewFile: (path: string) => void) => act(async () => {
    root.render(<EditedFilesSummary files={changedFiles(changes())} title="client.chat.changesThisTurn"
      status={status} onReview={() => {}} onReviewFile={onReviewFile} />);
  });
  try {
    await render('completed', reviewFirst);
    expect(container.querySelectorAll('li')).toHaveLength(3);
    await act(async () => (container.querySelector('[aria-expanded]') as HTMLButtonElement).click());
    await render('client.chat.editFailed', reviewLatest);
    expect(changedFiles(changes())).toBe(first);
    expect(container.querySelectorAll('li')).toHaveLength(5);
    expect(container.textContent).toContain(defaultText('client.chat.editFailed'));
    await act(async () => (container.querySelector('li button') as HTMLButtonElement).click());
    expect(reviewLatest).toHaveBeenCalledWith('src/0.ts');
    expect(reviewFirst).not.toHaveBeenCalled();
    await render('completed', reviewLatest);
    expect(container.textContent).toContain(defaultText('client.chat.edited'));
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
