import { accountName } from '../../../../shared/lounge/names';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ConversationRow } from '../../../../shared/lounge/conversationRows';
import { conversationPreviewText } from '../../../../shared/lounge/conversationPreview';
import type { MobileLounge } from '../../../../shared/lounge/useMobileLounge';
import { contactStatus } from '../../../../shared/lounge/contacts';
import { t, getLocale } from '../i18n';
import { LoungeAvatar } from './LoungeMessage';
import { LoungeSwipeRow } from './LoungeSwipeRow';
import { useLoungeStyles } from './styles';
import { useLoungeColor } from './theme';

export function LoungeChatRow({ row, model, actions }: {
  row: ConversationRow; model: MobileLounge; actions: () => void;
}) {
  const styles = useLoungeStyles(); const color = useLoungeColor();
  return <LoungeSwipeRow enabled={!!row.user && !!model.state.directResetAvailable && model.state.status === 'connected'}
    remove={() => model.setDeleting(row.user)}>
    <View style={styles.chatRow}>
      <Pressable accessibilityRole="button" style={styles.chatRowMain}
        accessibilityLabel={row.user ? t('client.lounge.directWith', { account: accountName(row.user) })
          : t('client.lounge.groupChat')}
        accessibilityHint={row.blocked ? t('client.lounge.blocked')
          : row.contact ? t(contactStatus(row.contact)) : undefined}
        onPress={() => model.select(row.user)} onLongPress={actions}>
        <View style={styles.chatAvatar}>
          {row.user ? <>
            <LoungeAvatar user={row.user} />
            <View pointerEvents="none" style={[styles.avatarPresence, !row.online && styles.offlineDot]} />
          </> : <View style={styles.avatar}>
            <Ionicons name="chatbubbles-outline" size={22} color={color('#456c96', 'info')} /></View>}
          {row.unread > 0 && <View pointerEvents="none" style={styles.chatAvatarBadge}>
            <Text style={styles.chatAvatarBadgeText}>{row.unread > 99 ? '99+' : row.unread}</Text></View>}
        </View>
        <View style={styles.heading}>
          <View style={styles.chatRowIdentity}>
            <Text style={[styles.rowTitle, styles.chatRowName]}>
              {row.user ? accountName(row.user) : t('client.lounge.groupChat')}</Text>
            {row.blocked && <View accessible accessibilityLabel={t('client.lounge.blocked')}
              style={styles.chatRowBlocked}>
              <Ionicons name="ban-outline" size={14} color={color('#687c89', 'muted')} accessible={false} />
            </View>}
          </View>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.muted}>{conversationPreviewText(row)}</Text>
        </View>
        <View style={styles.rowMeta}>
          {row.contact?.pinned && <View accessible accessibilityLabel={t('client.lounge.pinned')}>
            <Ionicons name="pin" size={14} color={color('#687c89', 'muted')} accessible={false} /></View>}
          {row.last && <Text style={styles.messageTime}>{new Date(row.last.sentAt).toLocaleTimeString(getLocale(), {
            hour: '2-digit', minute: '2-digit' })}</Text>}
          {row.notificationsMuted && <View accessible accessibilityLabel={t('client.lounge.notificationsMuted')}>
            <Ionicons name="notifications-off-outline" size={14} color={color('#687c89', 'muted')}
              accessible={false} /></View>}
        </View>
      </Pressable>
    </View>
  </LoungeSwipeRow>;
}
