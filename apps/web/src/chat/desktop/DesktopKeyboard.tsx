import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { DesktopInput, DesktopPlatform } from '../../../../../shared/remote-desktop/protocol';
import { desktopShortcuts, desktopModifiers, INPUT_TABS, KEYBOARD_PAGES }
  from '../../../../../shared/remote-desktop/softKeyboard';
import { useSoftKeyboard } from '../../../../../shared/remote-desktop/useSoftKeyboard';
import { bindDesktopIme } from '../../../../../shared/remote-desktop/ime';
import { t } from '../../i18n';
import './keyboard.css';

function DesktopIme({ input }: { input: (event: DesktopInput) => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const send = useRef(input); send.current = input;
  useEffect(() => {
    if (field.current) return bindDesktopIme(field.current, event => send.current(event));
  }, []);
  return <textarea ref={field} autoFocus rows={1} maxLength={1000} className="rd-ime"
    autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
    aria-label={t('发送到电脑的文字')} placeholder={t('输入文字，即时发送到电脑')} />;
}

export function DesktopKeyboard({ input, close, supported, platform }: {
  input: (event: DesktopInput) => void; close: () => void; supported: boolean;
  platform?: DesktopPlatform;
}) {
  const keyboard = useSoftKeyboard(input);
  return <section className="rd-keyboard" aria-label={t('远程输入')}>
    <div className="rd-input-tabs">
      <div role="tablist" aria-label={t('输入方式')}>
        {INPUT_TABS.map(tab => <button key={tab.id} role="tab" aria-selected={keyboard.tab === tab.id}
          onClick={() => keyboard.selectTab(tab.id)}>{t(tab.label)}</button>)}
      </div>
      <button className="rd-keyboard-close" aria-label={t('收起键盘')} onClick={close}><X size={23} /></button>
    </div>
    {keyboard.tab === 'ime' ? <DesktopIme input={input} />
      : <div className="rd-keyboard-content">
        {!supported && <p className="rd-keyboard-notice" role="status">
          {t('更新远程电脑上的应用后，即可使用这些按键。')}</p>}
        {keyboard.tab === 'shortcuts' ? <div className="rd-shortcuts">
          {desktopShortcuts(platform).map(shortcut => <button key={shortcut.label} disabled={!supported}
            onClick={() => keyboard.shortcut(shortcut.codes)}>
            <span>{shortcut.label}</span><small>{t(shortcut.description)}</small>
          </button>)}
        </div> : <div className="rd-computer-keys">
          <div className="rd-key-row">
            <label className="rd-combination"><input type="checkbox" checked={keyboard.combination}
              onChange={keyboard.toggleCombination} />{t('组合键模式')}</label>
            {desktopModifiers(platform).map(key => <button key={key.code}
              aria-pressed={keyboard.modifiers.includes(key.code)}
              disabled={!supported} onClick={() => keyboard.modifier(key.code)}>{key.label}</button>)}
          </div>
          {KEYBOARD_PAGES[keyboard.page].map((row, index) => <div key={index} className="rd-key-row">
            {row.map(key => <button key={key.code} disabled={!supported} style={{ flex: key.weight ?? 1 }}
              onClick={() => keyboard.press(key.code)}>{key.label}</button>)}
          </div>)}
          <div className="rd-key-pages">{KEYBOARD_PAGES.map((_, index) => <button key={index}
            aria-label={t(index === 0 ? '字母键盘' : '符号和功能键')} aria-pressed={keyboard.page === index}
            onClick={() => keyboard.setPage(index)}><span /></button>)}</div>
        </div>}
      </div>}
  </section>;
}
