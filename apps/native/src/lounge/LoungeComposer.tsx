import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MAX_IMAGES, MAX_TEXT, type LoungeDraft } from '../../../../shared/lounge/types';
import { displayText, t } from '../i18n';
import { useLoungeColor } from './theme';
import { LoungeFileButton } from './LoungeFileButton';
import { attachmentByteLimit } from '../../../../shared/lounge/attachments';
import { useLoungeAttachmentLimit } from '../../../../shared/lounge/useLoungeAttachmentLimit';
import { pickLoungeImages } from './images';
import { useLoungeStyles } from './styles';
import type { LoungeReply } from '../../../../shared/lounge/reply';
import { LoungeReplyPreview } from './LoungeReplyPreview';
import { sendError } from '../../../../shared/lounge/contacts';
import { useComposerDraft, type ComposerDraftState } from '../../../../shared/lounge/useComposerDraft';
import { LoungeSheet } from './LoungeSheet';
import { LoungeComposerAction } from './LoungeComposerAction';
import { LoungeEmojiPanel } from './LoungeEmojiPanel';
import { useLoungeEmoji } from './useLoungeEmoji';
import { LoungeImageAttachments } from './LoungeImageAttachments';
import { loungeMention, type LoungeComposerHandle } from '../../../../shared/lounge/mention';

export function LoungeComposer({ connected, send, onHistory, reply, cancelReply, draftState, extraActions,
  onOverlayChange, viewportHeight, composerRef, direct = false, filesAvailable = false }: {
  connected: boolean; send: (draft: LoungeDraft) => Promise<void>; onHistory: () => void;
  reply?: LoungeReply; cancelReply: (sent?: LoungeReply) => void;
  draftState: ComposerDraftState; extraActions: (close: () => void) => ReactNode;
  onOverlayChange: (open: boolean) => void;
  viewportHeight: number; direct?: boolean; filesAvailable?: boolean;
  composerRef?: Ref<LoungeComposerHandle>;
}) {
  const styles = useLoungeStyles();
  const imageLimit = useLoungeAttachmentLimit('image', direct);
  const color = useLoungeColor();
  const { text, setText, images, setImages, clearSent } = useComposerDraft(draftState);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [extras, setExtras] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  useEffect(() => {
    onOverlayChange(extras || editingImage);
    return () => onOverlayChange(false);
  }, [extras, editingImage, onOverlayChange]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(false);
  const locked = useRef(false);
  const input = useRef<TextInput>(null);
  const emoji = useLoungeEmoji({ input, text, setText, viewportHeight });
  useImperativeHandle(composerRef, () => ({ mention: user => {
    setExtras(false); emoji.close(); emoji.insert(loungeMention(user));
    requestAnimationFrame(() => input.current?.focus());
  } }));
  useEffect(() => { if (reply) input.current?.focus(); }, [reply]);
  const addImages = async () => {
    if (locked.current || editingImage) return;
    if (images.length >= MAX_IMAGES) { setError('client.lounge.tooManyImages'); return; }
    locked.current = true; setProcessing(true); setError('');
    try {
      const result = await pickLoungeImages({ remaining: MAX_IMAGES - images.length,
        maxBytes: attachmentByteLimit('image', direct) });
      setImages(current => [...current, ...result.images]); setNotice(result.flattened);
    } catch (failure) {
      setError(failure instanceof Error && failure.message.startsWith('client.lounge.')
        ? failure.message : 'client.lounge.imageFailed');
    } finally { locked.current = false; setProcessing(false); }
  };
  const submit = async () => {
    if (locked.current || editingImage || !connected || !text.trim() && !images.length) return;
    if ([...text].length > MAX_TEXT) { setError('client.lounge.tooLong'); return; }
    locked.current = true; setBusy(true); setError('');
    const sent = { text, images, reply };
    try {
      await send(sent); clearSent(sent); setNotice(false);
    }
    catch (failure) {
      setError(sendError(failure));
    } finally { locked.current = false; setBusy(false); }
  };
  return <View style={styles.composer}>
    {reply && <LoungeReplyPreview reply={reply} cancel={() => cancelReply()} />}
    <LoungeImageAttachments maxBytes={imageLimit} images={images} setImages={setImages}
      disabled={busy || processing} onEditingChange={setEditingImage} />
    <View style={styles.toolbar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('client.lounge.emoji')}
        accessibilityState={{ expanded: emoji.open }} disabled={busy} style={styles.iconButton} onPress={emoji.toggle}>
        <Ionicons name={emoji.open ? 'keypad-outline' : 'happy-outline'} size={24}
          color={emoji.open ? color('#456c96', 'info') : color('#687c89', 'muted')} /></Pressable>
    <TextInput ref={input} multiline value={text} onChangeText={setText}
      selection={emoji.selection} onFocus={emoji.close}
      style={styles.input}
      onSelectionChange={event => emoji.changeSelection(event.nativeEvent.selection)}
      accessibilityLabel={t('client.lounge.message')} placeholder={t('client.lounge.mobilePlaceholder')}
      placeholderTextColor={color('#838892', 'muted')} />
      <Pressable accessibilityRole="button" accessibilityLabel={t('client.lounge.more')} style={styles.iconButton}
        onPress={() => { emoji.close(); Keyboard.dismiss(); setExtras(true); }}>
        <Ionicons name="add" size={24} color={color('#687c89', 'muted')} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t(busy ? 'client.lounge.sending' : 'client.lounge.send')}
        onPress={() => void submit()}
        disabled={!connected || busy || processing || editingImage || !text.trim() && !images.length}
        style={[styles.send,
          (!connected || busy || processing || editingImage || !text.trim() && !images.length) && styles.disabled]}>
        <Ionicons name="arrow-up" size={22} color={color('#fff', 'canvas')} /></Pressable>
    </View>
    {processing && <Text style={styles.muted}>{t('client.lounge.preparingImage')}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{displayText(error)}</Text>}
    {notice && <Text style={styles.muted}>{t('client.lounge.stillImage')}</Text>}
    {emoji.open && <LoungeEmojiPanel height={emoji.panelHeight} insert={emoji.insert} />}
    {extras && <LoungeSheet title={t('client.lounge.more')} close={() => setExtras(false)} actions>
      <View style={styles.extraActions}>
        {direct && filesAvailable && <LoungeFileButton send={send} disabled={!connected || busy}
          close={() => setExtras(false)} />}
        <LoungeComposerAction icon="image-outline" label={t('client.lounge.addImage')}
          hint={t('client.lounge.mobileImageHint', { size: imageLimit / 1024 / 1024 })}
          disabled={busy || processing} onPress={() => { setExtras(false); void addImages(); }} />
        <LoungeComposerAction icon="time-outline" label={t('client.lounge.history')}
          onPress={() => { setExtras(false); onHistory(); }} />
        {extraActions(() => setExtras(false))}
      </View>
    </LoungeSheet>}
  </View>;
}
