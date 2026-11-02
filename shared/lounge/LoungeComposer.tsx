import { useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type ReactNode, type Ref } from 'react';
import { ArrowUp, Clock3, History, Image, ImagePlus, Keyboard, Plus, Send, Smile } from 'lucide-react';
import { displayText as t } from '../localization/messages';
import { MAX_IMAGES, MAX_TEXT, type LoungeDraft } from './types';
import { LoungeFileButton } from './LoungeFileButton';
import { attachmentByteLimit } from './attachments';
import { useLoungeAttachmentLimit } from './useLoungeAttachmentLimit';
import { prepareImage } from './images';
import { LoungeEmojiPicker } from './LoungeEmojiPicker';
import { sendError } from './contacts';
import type { LoungeReply } from './reply';
import { LoungeReplyPreview } from './LoungeReplyPreview';
import { useComposerDraft, type ComposerDraftState } from './useComposerDraft';
import { MobileLoungeSheet } from './MobileLoungeSheet';
import { MobileLoungeEmojiPanel, useMobileEmojiHeight } from './MobileLoungeEmojiPanel';
import { insertLoungeEmoji } from './emoji';
import { LoungeImageAttachments } from './LoungeImageAttachments';
import { loungeMention, type LoungeComposerHandle } from './mention';

export type { LoungeComposerHandle } from './mention';

export function LoungeComposer({ connected, send, onHistory, mobile = false, reply, cancelReply,
  draftState, extraActions, onOverlayChange, composerRef, assistance, direct = false, filesAvailable = false }: {
  connected: boolean; send: (draft: LoungeDraft) => Promise<void>; onHistory: () => void; mobile?: boolean;
  reply?: LoungeReply; cancelReply: (sent?: LoungeReply) => void;
  draftState?: ComposerDraftState; extraActions?: (close: () => void) => ReactNode;
  onOverlayChange?: (open: boolean) => void;
  composerRef?: Ref<LoungeComposerHandle>;
  assistance?: ReactNode; direct?: boolean; filesAvailable?: boolean;
}) {
  const { text, setText, images, setImages, clearSent } = useComposerDraft(draftState);
  const imageLimit = useLoungeAttachmentLimit('image', direct);
  const [extras, setExtras] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  useEffect(() => {
    onOverlayChange?.(extras || editingImage || !mobile && emojiOpen);
    return () => onOverlayChange?.(false);
  }, [extras, editingImage, emojiOpen, mobile, onOverlayChange]);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const emojiHeight = useMobileEmojiHeight(mobile, textarea);
  const picker = useRef<HTMLInputElement>(null);
  const adding = useRef(false);
  const submitting = useRef(false);
  const selection = useRef({ start: text.length, end: text.length });
  useEffect(() => {
    if (!mobile || !emojiOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEmojiOpen(false);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [mobile, emojiOpen]);
  useEffect(() => { if (reply) textarea.current?.focus(); }, [reply]);
  useEffect(() => {
    if (!mobile || !textarea.current) return;
    textarea.current.style.height = '0px';
    textarea.current.style.height = `${Math.min(132, Math.max(44, textarea.current.scrollHeight))}px`;
  }, [mobile, text]);

  const addImages = async (files: File[]) => {
    if (!files.length || adding.current || submitting.current || editingImage) return;
    if (images.length + files.length > MAX_IMAGES) { setError('client.lounge.tooManyImages'); return; }
    adding.current = true; setProcessing(true); setError(''); setNotice('');
    try {
      const prepared: string[] = [];
      let flattened = false;
      for (const file of files) {
        const result = await prepareImage(file, attachmentByteLimit('image', direct));
        prepared.push(result.data); flattened ||= result.flattened;
      }
      setImages(current => [...current, ...prepared]);
      if (flattened) setNotice('client.lounge.stillImage');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'client.lounge.imageFailed'); }
    finally { adding.current = false; setProcessing(false); }
  };
  const submit = async () => {
    if (!connected || submitting.current || adding.current || editingImage || !text.trim() && !images.length) return;
    if ([...text].length > MAX_TEXT) { setError('client.lounge.tooLong'); return; }
    submitting.current = true; setBusy(true); setError('');
    const sent = { text, images, reply };
    try {
      await send(sent); clearSent(sent); setNotice('');
      if (reply && !draftState) cancelReply(reply);
    }
    catch (failure) {
      setError(sendError(failure));
    }
    finally { submitting.current = false; setBusy(false); }
  };
  const insertEmoji = (emoji: string) => {
    const next = insertLoungeEmoji(text, selection.current, emoji);
    selection.current = next.selection;
    setText(next.text);
    requestAnimationFrame(() => {
      if (!mobile) textarea.current?.focus();
      textarea.current?.setSelectionRange(next.selection.start, next.selection.end);
    });
  };
  const toggleEmoji = () => {
    if (emojiOpen) { setEmojiOpen(false); textarea.current?.focus(); return; }
    if (textarea.current) selection.current = {
      start: textarea.current.selectionStart, end: textarea.current.selectionEnd,
    };
    textarea.current?.blur(); setExtras(false); setEmojiOpen(true);
  };
  // Use the public account identifier: a private contact remark must never be included in a mention.
  useImperativeHandle(composerRef, () => ({ mention: user => {
    if (textarea.current) selection.current = {
      start: textarea.current.selectionStart, end: textarea.current.selectionEnd,
    };
    setEmojiOpen(false); setExtras(false);
    textarea.current?.focus();
    insertEmoji(loungeMention(user));
  } }));
  const paste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    const pastedText = event.clipboardData.getData('text/plain');
    if (pastedText) setText(value => value + pastedText);
    void addImages(files);
  };

  return <section className="lounge-composer" onDragOver={event => event.preventDefault()}
    onDrop={event => { event.preventDefault(); void addImages(Array.from(event.dataTransfer.files)); }}>
    <div className="lounge-toolbar">
      {mobile ? <div className="lounge-emoji-control">
        <button type="button" disabled={busy} aria-label={t('client.lounge.emoji')}
          aria-expanded={emojiOpen} aria-controls={emojiOpen ? 'lounge-mobile-emoji' : undefined}
          onPointerDown={event => event.preventDefault()} onClick={toggleEmoji}>
          {emojiOpen ? <Keyboard size={22} /> : <Smile size={22} />}</button>
      </div> : <LoungeEmojiPicker disabled={busy} insert={insertEmoji} onOpenChange={setEmojiOpen} />}
      {!mobile && <button type="button" disabled={busy || processing} aria-label={t('client.lounge.addImage')}
        title={t(mobile ? 'client.lounge.mobileImageHint' : 'client.lounge.imageHint',
          { size: imageLimit / 1024 / 1024 })}
        onClick={() => picker.current?.click()}><ImagePlus size={22} /></button>}
      {!mobile && direct && filesAvailable && <LoungeFileButton send={send} disabled={!connected || busy} />}
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden
        onChange={event => { void addImages(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      {processing && <span role="status">{t('client.lounge.preparingImage')}</span>}
      {!mobile && <div className="lounge-toolbar-end">{assistance}
        <button type="button" className="lounge-history-button" onClick={onHistory}
          aria-label={t('client.lounge.history')} title={t('client.lounge.history')}><History size={22} /></button>
      </div>}
    </div>
    {reply && <LoungeReplyPreview reply={reply} cancel={() => cancelReply()} />}
    <LoungeImageAttachments maxBytes={imageLimit} images={images} setImages={setImages}
      disabled={busy || processing} onEditingChange={setEditingImage} />
    <textarea ref={textarea} rows={mobile ? 1 : undefined} value={text}
      onFocus={() => { if (mobile) setEmojiOpen(false); }}
      aria-label={t('client.lounge.message')}
      placeholder={t(mobile ? 'client.lounge.mobilePlaceholder' : 'client.lounge.placeholder')}
      onChange={event => setText(event.target.value)}
      onSelect={event => { if (mobile && emojiOpen) return; selection.current = { start: event.currentTarget.selectionStart,
        end: event.currentTarget.selectionEnd }; }} onPaste={paste}
      onKeyDown={event => {
        if (!mobile && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
          event.preventDefault(); void submit();
        }
      }} />
    {error && <p className="lounge-composer-error" role="alert">{t(error)}</p>}
    {notice && <p className="lounge-composer-notice">{t(notice)}</p>}
    {mobile && <button type="button" className="lounge-more" aria-label={t('client.lounge.more')}
      onClick={() => { textarea.current?.blur(); setEmojiOpen(false); setExtras(true); }}><Plus size={24} /></button>}
    <footer>{!mobile && <small>{t('client.lounge.sendHint')}</small>}
      <button className="lounge-send" type="button" onClick={() => void submit()}
        onPointerDown={event => {
          if (event.button === 0 && document.activeElement === textarea.current) event.preventDefault();
        }}
        aria-label={t(busy ? 'client.lounge.sending' : 'client.lounge.send')}
        disabled={!connected || busy || processing || editingImage || !text.trim() && !images.length}>
        {mobile ? <ArrowUp size={22} /> : <><Send size={16} />{t(busy ? 'client.lounge.sending' : 'client.lounge.send')}</>}
      </button></footer>
    {mobile && emojiOpen && <MobileLoungeEmojiPanel height={emojiHeight} insert={insertEmoji} />}
    {mobile && extras && <MobileLoungeSheet title={t('client.lounge.more')} close={() => setExtras(false)} actions>
      <div className="lounge-extra-actions">
        {direct && filesAvailable && <LoungeFileButton send={send} disabled={!connected || busy}
          close={() => setExtras(false)} />}
        <button type="button" disabled={busy || processing} onClick={() => {
          setExtras(false); picker.current?.click();
        }}><Image size={24} />{t('client.lounge.addImage')}</button>
        <button type="button" onClick={() => { setExtras(false); onHistory(); }}>
          <Clock3 size={24} />{t('client.lounge.history')}</button>
        {extraActions?.(() => setExtras(false))}
      </div>
    </MobileLoungeSheet>}
  </section>;
}
