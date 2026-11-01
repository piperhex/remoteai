import { type CSSProperties, type KeyboardEvent } from 'react';
import type { SettingField, SettingOption } from '../../../../shared/remote-chat/settingsMenu';
import { settingSegmentColor } from '../../../../shared/remote-chat/settingSegments';
import { SETTING_SHORT_LABELS, settingShortLabel } from '../../../../shared/remote-chat/settingsPresentation';
import { displayText, useLanguage } from '../i18n';
import { useSettingSegmentDrag } from './useSettingSegmentDrag';
import './chatSettingSegments.css';

interface Props {
  field: SettingField;
  compact: boolean;
  label: string;
  value: string;
  options: SettingOption[];
  onChange: (value: string) => void;
  inactive: boolean;
}

export function ChatSettingSegments({ field, compact, label, value, options, onChange, inactive }: Props) {
  const language = useLanguage();
  const stacked = language !== 'zh' && language !== 'ja';
  const selected = options.findIndex(option => option.value === value);
  const select = (index: number) => { if (!inactive && options[index]) onChange(options[index].value); };
  const { preview, handlers } = useSettingSegmentDrag(inactive ? 0 : options.length, select);
  const active = preview ?? selected;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const changes: Record<string, number> = {
      ArrowLeft: Math.max(0, selected - 1), ArrowRight: Math.min(options.length - 1, selected + 1),
      Home: 0, End: options.length - 1,
    };
    const index = changes[event.key];
    if (index === undefined) return;
    event.preventDefault();
    select(index);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus();
  };
  if (!options.length) return null;
  return <div className={compact ? `chat-setting-segments-row${stacked ? ' is-stacked' : ''}` : undefined}>
    {compact && <strong className="chat-setting-segments-label">{displayText(SETTING_SHORT_LABELS[field])}</strong>}
    <div className="chat-setting-segments-rail"
    style={{ '--setting-accent': settingSegmentColor(active, options.length) } as CSSProperties}>
      <div className="chat-setting-segments-track" role="radiogroup" aria-label={label}
        onKeyDown={onKeyDown} {...handlers}>
        {active >= 0 && <span className="chat-setting-segments-thumb" aria-hidden="true"
          style={{ width: `${100 / options.length}%`, transform: `translateX(${active * 100}%)` }} />}
        {options.map((option, index) => <button key={option.value} type="button" role="radio"
          aria-label={displayText(option.label)}
          aria-checked={selected === index} className={active === index ? 'is-selected' : undefined}
          aria-description={option.description ? displayText(option.description) : undefined}
          tabIndex={!inactive && (selected === index || (selected < 0 && index === 0)) ? 0 : -1}
          onClick={() => select(index)}>
          {compact && index > 0 && index !== active && index - 1 !== active
            && <span className="chat-setting-segments-divider" aria-hidden="true" />}
          {displayText(compact ? settingShortLabel(field, option) : option.label)}</button>)}
      </div>
    </div>
  </div>;
}
