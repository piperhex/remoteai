import { LoungeAttachment } from './LoungeAttachment';
import { accountName } from '../../../../shared/lounge/names';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useRef, useState, type ReactNode } from 'react';
import { initials, type LoungeAccount, type LoungeMessage as Message } from '../../../../shared/lounge/types';
import { getLocale, t } from '../i18n';
import { UNREAD_BADGE_FONT_SIZE, UNREAD_BADGE_HORIZONTAL_PADDING, useLoungeStyles } from './styles';
import { LoungeReplyPreview } from './LoungeReplyPreview';
import { LoungeMessageActions } from './LoungeMessageActions';
import { LoungeImage } from './LoungeImage';
import { LoungeDeliveryStatus } from './LoungeDeliveryStatus';
import { messageMinimumWidth } from './messageLayout';
import { LoungeSender } from './LoungeSender';
import type { LoungeReply } from '../../../../shared/lounge/reply';
import type { LoungeController } from '../../../../shared/lounge/controller';
import type { MenuAnchor } from '../../../../shared/lounge/messageMenuLayout';
import { HISTORY_MESSAGE_FONT_SIZE, useHistoryStyles } from './historyStyles';

const MESSAGE_AVATAR_TOUCH_PADDING = 7;

export function LoungeAvatar({ user, size, onDirect, onProfile, onLongPress, onMention }: {
  user: LoungeAccount; size?: 'small' | 'profile' | 'history'; onDirect?: () => void;
  onProfile?: () => void; onLongPress?: () => void; onMention?: () => void;
}) {
  const styles = useLoungeStyles();
  const historyStyles = useHistoryStyles();
  const mentionPending = useRef(false);
  const small = size === 'small' || size === 'history';
  const avatarStyle = [styles.avatar, small && styles.messageAvatar, size === 'profile' && styles.profileAvatar,
    size === 'history' && historyStyles.avatar];
  const avatar = user.avatar ? <Image source={{ uri: user.avatar }}
    style={avatarStyle} />
    : <View style={avatarStyle}>
      <Text style={[small ? styles.messageName : styles.initials, size === 'profile' && styles.profileInitials]}>
        {initials(accountName(user))}</Text></View>;
  const action = onProfile ?? onDirect;
  return action ? <Pressable accessibilityRole="button" onPress={action}
    onLongPress={onMention ? () => { mentionPending.current = true; } : onLongPress}
    onPressOut={() => {
      // Finish the touch before a history mention removes its modal and focuses the composer.
      if (mentionPending.current) { mentionPending.current = false; onMention?.(); }
    }}
    hitSlop={small ? MESSAGE_AVATAR_TOUCH_PADDING : 0}
    accessibilityLabel={t(onProfile ? 'client.lounge.viewProfile' : 'client.lounge.directWith', {
      account: accountName(user) })}>{avatar}</Pressable> : avatar;
}

export function LoungeUnread({ count, children }: { count: number; children: ReactNode }) {
  const styles = useLoungeStyles();
  const { fontScale } = useWindowDimensions();
  const label = count > 99 ? '99+' : String(count);
  // Absolute children are measured against the icon width; reserve scalable space for every glyph.
  const minWidth = UNREAD_BADGE_HORIZONTAL_PADDING * 2 + label.length * UNREAD_BADGE_FONT_SIZE * fontScale;
  return <View style={styles.badgeWrap}>{children}{count > 0 && <View style={[styles.badge, { minWidth }]}>
    <Text style={styles.badgeText}>{label}</Text>
  </View>}</View>;
}

interface Props {
  message: Message; own?: boolean; manage?: (user: LoungeAccount) => void;
  preview: (uri: string) => void; onImageLoad?: () => void;
  reply?: (message: Message) => void;
  direct?: () => void; block?: () => void; blocked?: boolean;
  profile?: () => void; mention?: () => void;
  controller: LoungeController; locate?: (reference: LoungeReply) => void; highlighted?: boolean;
  history?: boolean;
}
export function LoungeMessage({ message, own, manage, preview, onImageLoad, reply, direct, block, blocked,
  profile, mention, controller, locate, highlighted, history = false }: Props) {
  const styles = useLoungeStyles();
  const historyStyles = useHistoryStyles();
  const [menu, setMenu] = useState<MenuAnchor>();
  const bubble = useRef<View>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const minWidth = Math.min(availableWidth,
    messageMinimumWidth(message.text, fontScale, history ? HISTORY_MESSAGE_FONT_SIZE : undefined));
  const timestamp = new Date(message.sentAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
  const openMenu = reply ? () => bubble.current?.measureInWindow((x, y, width, height) => {
    if (width && height) setMenu({ x, y, width, height });
  }) : undefined;
  return <View style={[styles.message, own && styles.own, highlighted && styles.highlighted,
    history && historyStyles.message]}>
    <LoungeAvatar user={message.sender} size={history ? 'history' : 'small'} onDirect={direct}
      onProfile={profile} onMention={mention} />
    <View style={[styles.messageMain, own && styles.ownMain]}
      onLayout={event => setAvailableWidth(event.nativeEvent.layout.width)}>
      <LoungeSender user={message.sender} manage={!own && manage ? () => manage(message.sender) : undefined} />
      <Pressable ref={bubble} onLongPress={openMenu} style={[styles.bubble, own && styles.ownBubble,
        history && historyStyles.bubble, history && own && historyStyles.ownBubble,
        { minWidth }, message.reply && styles.quotedBubble,
        !message.text.trim() && !message.reply && styles.imageOnly]}>
        {message.reply && <LoungeReplyPreview reply={message.reply} controller={controller}
          locate={locate} onLongPress={openMenu} />}
        {!!message.text && <Text selectable={!reply} onLongPress={openMenu}
          style={[styles.messageText, history && historyStyles.messageText]}>{message.text}</Text>}
        {message.attachments?.map(file => <LoungeAttachment key={file.id} file={file}
          controller={controller} preview={preview} onLoad={onImageLoad} onLongPress={openMenu} />)}
        {message.images.map((uri, index) => <LoungeImage key={index} uri={uri} preview={preview}
          onLongPress={openMenu} onLoad={onImageLoad} />)}
      </Pressable>
      {history ? <View style={historyStyles.footer}>
        <Text style={historyStyles.time}>{timestamp}</Text>
        <LoungeDeliveryStatus delivery={message.delivery} inline />
      </View> : <>
        <Text style={styles.messageTime}>{timestamp}</Text>
        <LoungeDeliveryStatus delivery={message.delivery} />
      </>}
    </View>
    {menu && reply && <LoungeMessageActions anchor={menu} message={message} reply={reply} close={() => setMenu(undefined)}
      direct={direct} block={block} blocked={blocked} />}
  </View>;
}
