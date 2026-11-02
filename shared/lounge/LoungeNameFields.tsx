import { Button, Input, Popover } from 'antd';
import { ChevronRight, X } from 'lucide-react';
import { displayText as t } from '../localization/messages';
import { useLoungeNameEditor, type LoungeNameEditorOptions } from './useLoungeNameEditor';
import './nameFields.css';

function NicknameValue({ nickname, desktop }: { nickname?: string; desktop: boolean }) {
  const value = nickname || t('client.lounge.nameNotSet');
  return <div className="lounge-name-readonly"><span>{t('client.lounge.nickname')}</span>
    {desktop ? <Popover trigger="click" title={t('client.lounge.nickname')}
      rootClassName="lounge-nickname-popover" content={<span>{value}</span>}>
      <button type="button" className="lounge-nickname-value"><span>{value}</span>
        <ChevronRight size={20} aria-hidden="true" /></button>
    </Popover> : <strong>{value}</strong>}
  </div>;
}

export function LoungeNameFields({ desktop = false, ...props }: LoungeNameEditorOptions & { desktop?: boolean }) {
  const editor = useLoungeNameEditor(props);
  const label = t(editor.own ? 'client.lounge.nickname' : 'client.lounge.remark');
  return <div className={`lounge-name-fields${desktop ? ' lounge-desktop-profile-fields' : ''}`}>
    {!editor.own && <NicknameValue nickname={props.user.nickname} desktop={desktop} />}
    <form onSubmit={event => { event.preventDefault(); void editor.save(); }}>
      <label htmlFor="lounge-profile-name">{label}</label>
      {editor.own && !desktop && <p className="lounge-name-hint">{t('client.lounge.nicknameHint')}</p>}
      <Input id="lounge-profile-name" value={editor.value} onChange={event => editor.change(event.target.value)}
        onBlur={() => void editor.save()} aria-label={label} autoComplete="off"
        status={editor.invalid ? 'error' : undefined}
        suffix={desktop && <span className="lounge-name-clear-slot">{editor.value && <button type="button"
          className="lounge-name-clear" aria-label={t(editor.own
            ? 'client.lounge.clearNickname' : 'client.lounge.clearRemark')}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { editor.change(''); void editor.save(); }}><X size={14} aria-hidden="true" /></button>}</span>}
        placeholder={t('client.lounge.nameNotSet')} />
      {editor.own && <>
        {desktop && <p className="lounge-name-hint">{t('client.lounge.nicknameHint')}</p>}
        <p className="lounge-name-hint">{t('client.lounge.nameLimit', { limit: editor.limit })}</p>
        <p className="lounge-name-hint">{t('client.lounge.nameAutosaveHint')}</p>
      </>}
      {!editor.available && <p role="status">{t('client.lounge.namesUnavailable')}</p>}
      {editor.invalid && <p role="alert">{t('client.lounge.nameInvalid', { limit: editor.limit })}</p>}
      {editor.error && <div className="lounge-name-error"><p role="alert">{t(editor.error)}</p>
        <Button type="link" onClick={() => void editor.save()} disabled={!editor.available || editor.invalid}>
          {t('client.lounge.nameRetry')}</Button></div>}
      {editor.busy && <p role="status">{t('client.lounge.nameSaving')}</p>}
      {editor.saved && <p role="status">{t('client.lounge.nameSaved')}</p>}
    </form>
  </div>;
}
