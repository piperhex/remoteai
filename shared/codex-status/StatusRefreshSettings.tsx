import { useEffect, useId, useState } from 'react';
import type { MessageTranslator } from '../localization/messages';
import { DEFAULT_REFRESH_MINUTES, MAX_REFRESH_MINUTES, MIN_REFRESH_MINUTES,
  saveStatusRefreshMinutes, useStatusRefreshMinutes } from './preferences';
import './status.css';

export function StatusRefreshSettings({ t }: { t: MessageTranslator }) {
  const minutes = useStatusRefreshMinutes();
  const [draft, setDraft] = useState(String(minutes));
  const hint = useId();
  useEffect(() => setDraft(String(minutes)), [minutes]);
  return <div className="codex-status-settings">
    <label><span>{t('client.codexStatus.refreshMinutes')}</span>
      <input type="number" min={MIN_REFRESH_MINUTES} max={MAX_REFRESH_MINUTES} step={1}
        value={draft} aria-describedby={hint} onChange={event => {
          setDraft(event.target.value);
          if (event.target.value && event.target.validity.valid) saveStatusRefreshMinutes(event.target.valueAsNumber);
        }} onBlur={() => setDraft(String(minutes))} />
    </label>
    <p id={hint}>{t('client.codexStatus.refreshHint', {
      min: MIN_REFRESH_MINUTES, max: MAX_REFRESH_MINUTES, minutes: DEFAULT_REFRESH_MINUTES,
    })}</p>
  </div>;
}
