// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

it('keeps the host language when shared Web chat loads and follows later switches without changing preferences',
  async () => {
    vi.resetModules();
    const preferenceKey = 'codex-switch.web.language.v1';
    localStorage.setItem(preferenceKey, 'en');
    const { setGuiLanguage } = await import('../../../../shared/localization/uiText');
    setGuiLanguage('ja');
    const chat = await import('../../../../shared/localization/browserClient');
    expect(chat.getLanguage()).toBe('ja');
    expect(chat.t('client.chat.chatMessage')).toBe('チャットメッセージ');
    for (const language of ['ru', 'en', 'zh', 'ja'] as const) {
      setGuiLanguage(language);
      expect(chat.getLanguage()).toBe(language);
      expect(localStorage.getItem(preferenceKey)).toBe('en');
    }
  });
