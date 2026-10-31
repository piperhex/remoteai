import { useState, useSyncExternalStore } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Modal } from '../components/Modal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLoungeHistory } from '../../../../shared/lounge/useLoungeHistory';
import type { LoungeController } from '../../../../shared/lounge/controller';
import type { LoungeAccount, LoungeMessage as Message } from '../../../../shared/lounge/types';
import { t } from '../i18n';
import { useThemeColor } from '../theme/store';
import { LoungeMessage } from './LoungeMessage';
import { LoungePreview } from './LoungePreview';
import { useLoungeStyles } from './styles';
import type { LoungeReply } from '../../../../shared/lounge/reply';
import type { LoungeNavigationError } from '../../../../shared/lounge/useLoungeNavigation';

export function LoungeHistory({ controller, close, reply, direct, profile, mention, locate, navigationError }: {
  controller: LoungeController; close: () => void; reply: (message: Message) => void;
  direct: (user: LoungeAccount) => void;
  profile: (user: LoungeAccount) => void;
  mention: (user: LoungeAccount) => void;
  locate: (reference: LoungeReply) => void; navigationError?: LoungeNavigationError;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const styles = useLoungeStyles();
  const color = useThemeColor();
  const history = useLoungeHistory(controller, true);
  const [preview, setPreview] = useState<string>();
  return <Modal animationType="slide" onRequestClose={close}><SafeAreaView style={styles.page}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" style={styles.iconButton} onPress={close}>
        <Text style={styles.link}>{t('client.lounge.backToChat')}</Text></Pressable>
      <Text accessibilityRole="header" style={styles.title}>{t('client.lounge.history')}</Text>
    </View>
    <View style={styles.composer}>
      <TextInput value={history.query} onChangeText={history.setQuery} style={styles.field}
        accessibilityLabel={t('client.lounge.searchHistory')} placeholder={t('client.lounge.searchHistory')}
        placeholderTextColor={color('#838892', 'muted')} />
      <Text style={styles.muted}>{t('client.lounge.historyHint')}</Text>
      <Text style={styles.muted}>{history.loading ? t('client.lounge.historyLoading')
        : t('client.lounge.historyCount', { count: history.messages.length })}</Text>
      {history.error && <View><Text style={styles.muted}>{t('client.lounge.historyLoadFailed')}</Text>
        <Pressable accessibilityRole="button" onPress={history.retry} style={styles.iconButton}>
          <Text style={styles.link}>{t('client.lounge.historyRetry')}</Text></Pressable></View>}
      {navigationError && <Text accessibilityRole="alert" style={styles.error}>{t(navigationError)}</Text>}
    </View>
    <FlatList data={history.messages} keyExtractor={item => `${item.sender.id}:${item.id}`}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <LoungeMessage message={item} preview={setPreview} reply={reply}
        controller={controller} locate={locate} own={item.sender.id === state.user?.id}
        profile={() => profile(item.sender)}
        mention={item.sender.id !== state.user?.id ? () => mention(item.sender) : undefined}
        direct={state.directAvailable && item.sender.id !== state.user?.id
          ? () => { close(); direct(item.sender); } : undefined} />}
      ListEmptyComponent={!history.loading && !history.error ? <Text style={styles.muted}>{t(history.query.trim()
        ? 'client.lounge.historyNoResults' : 'client.lounge.historyEmpty')}</Text> : null} />
    <View style={styles.header}>
      <Pressable accessibilityRole="button" disabled={history.loading || !history.hasPrevious}
        accessibilityState={{ disabled: history.loading || !history.hasPrevious }}
        onPress={history.previous} style={styles.iconButton}>
        <Text style={history.hasPrevious ? styles.link : styles.muted}>{t('client.lounge.historyPrevious')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={history.loading || !history.hasNext}
        accessibilityState={{ disabled: history.loading || !history.hasNext }}
        onPress={history.next} style={styles.iconButton}>
        <Text style={history.hasNext ? styles.link : styles.muted}>{t('client.lounge.historyNext')}</Text>
      </Pressable>
    </View>
    {preview && <LoungePreview uri={preview} close={() => setPreview(undefined)} />}
  </SafeAreaView></Modal>;
}
