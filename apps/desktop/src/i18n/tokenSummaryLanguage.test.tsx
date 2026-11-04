// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatTokenSummary } from '../../../web/src/chat/ChatTokenSummary';
import { setInterfaceLanguage } from '../../../../shared/localization/interfaceLanguage';
import { translateMessage } from '../../../../shared/localization/messages';
import { TOKEN_FIELDS, CONTEXT_FIELDS, MODE_FIELDS } from '../../../../shared/remote-chat/tokenSummaryLabels';
import type { TokenSummary } from '../../../../shared/remote-chat/tokenSummary';
import { EditedFilesSummary } from '../../../../shared/conversation/EditedFilesSummary';
import { DiffTextContext } from '../../../../shared/chat/diffText';
import { displayText } from '../../../../shared/localization/messages';
import { changedFiles } from '../../../../shared/conversation/diff';

vi.mock('../../../../shared/layout/AdaptiveSheet', () => ({
  AdaptiveSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../web/src/chat/OfficialUsagePanel', () => ({ OfficialUsagePanel: () => null }));

const data: TokenSummary = { weeks: 4, refreshSeconds: 3600, thresholdTokens: 128000,
  startTs: 0, endTs: 1, dateKeys: [], dailyUsage: [], breakdown: [], quotaHistory: [],
  rankings: { providers: [['用户 Provider', 20]], models: [], accounts: [] }, entryCount: 1,
  errors: { usage: false, analytics: false, quota: false } };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setInterfaceLanguage('zh');
  container = document.createElement('div');
  root = createRoot(container);
});

it('preserves unapplied change states in the shared local, remote and Web file summary', async () => {
  const files = changedFiles([{ path: '用户文件.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old\n+new\n' }]);
  for (const language of ['en', 'ru', 'ja', 'zh'] as const) {
    for (const key of ['client.chat.notApplied', 'client.chat.editFailed',
      'client.chat.editing', 'client.chat.reverted'] as const) {
      const translated = translateMessage(language, key);
      for (const status of [key, translated]) {
        await act(async () => root.render(
          <DiffTextContext.Provider value={(value, params) => displayText(value, params, language)}>
            <EditedFilesSummary files={files} status={status} title="client.chat.changesThisTurn"
              onReview={() => {}} onReviewFile={() => {}} />
          </DiffTextContext.Provider>,
        ));
        expect(container.querySelector('strong')?.textContent).toContain(translated);
        expect(container.textContent).toContain('用户文件.ts');
      }
    }
  }
});
afterEach(async () => {
  await act(async () => root.unmount());
  setInterfaceLanguage('zh');
  vi.unstubAllGlobals();
});

it('switches Web token categories and quota labels while keeping the selected interval and user names', async () => {
  await act(async () => root.render(<ChatTokenSummary read={async () => data} ready scope="language-test"
    onClose={() => {}} />));
  const interval = container.querySelector<HTMLSelectElement>(`[aria-label="${translateMessage("zh", "client.chat.quotaInterval")}"]`);
  expect(interval).not.toBeNull();
  await act(async () => {
    interval!.value = 'day';
    interval!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  for (const language of ['en', 'ru', 'ja', 'zh'] as const) {
    await act(async () => setInterfaceLanguage(language));
    for (const [key] of [...TOKEN_FIELDS, ...CONTEXT_FIELDS, ...MODE_FIELDS]) {
      expect(container.textContent).toContain(translateMessage(language, key));
    }
    expect(container.textContent).toContain(translateMessage(language, 'client.chat.hourly'));
    expect(container.textContent).toContain('用户 Provider');
    expect(interval?.value).toBe('day');
  }
});
