import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Modal } from '../components/Modal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHistoryTimeline, type HistoryTimelineModel } from '../../../../shared/lounge/useHistoryTimeline';
import { historyTimelineRows } from '../../../../shared/lounge/historyTimelineRows';
import type { LoungeController } from '../../../../shared/lounge/controller';
import type { LoungeAccount, LoungeMessage as Message } from '../../../../shared/lounge/types';
import type { LoungeReply } from '../../../../shared/lounge/reply';
import type { LoungeNavigationError } from '../../../../shared/lounge/useLoungeNavigation';
import { getLocale, t } from '../i18n';
import { LoungeMessage } from './LoungeMessage';
import { LoungePreview } from './LoungePreview';
import { useHistoryStyles } from './historyStyles';
import { useLoungeColor } from './theme';

export function LoungeHistory({ controller, close, reply, direct, profile, mention, locate, navigationError }: {
  controller: LoungeController; close: () => void; reply: (message: Message) => void;
  direct: (user: LoungeAccount) => void; profile: (user: LoungeAccount) => void;
  mention: (user: LoungeAccount) => void; locate: (reference: LoungeReply) => void;
  navigationError?: LoungeNavigationError;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const styles = useHistoryStyles();
  const history = useHistoryTimeline(controller);
  const locale = getLocale();
  const rows = useMemo(() => historyTimelineRows(history.messages, locale), [history.messages, locale]);
  const [preview, setPreview] = useState<string>();
  const nearLatest = useRef(true);
  useEffect(() => {
    if (nearLatest.current && history.hasNewer && !history.loading) history.newer();
  }, [history.hasNewer, history.loading, history.newer]);
  return <Modal animationType="slide" onRequestClose={close}><SafeAreaView style={styles.page}>
    <HistoryHeader history={history} close={close} />
    {navigationError && <Text accessibilityRole="alert" style={styles.statusText}>{t(navigationError)}</Text>}
    {history.error && rows.length > 0 && <HistoryStatus history={history} />}
    {!rows.length && <HistoryStatus history={history} />}
    <FlatList key={history.key} inverted data={rows} keyExtractor={item => item.key}
      contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onEndReached={history.older} onEndReachedThreshold={0.75}
      onStartReached={history.newer} onStartReachedThreshold={0.75} scrollEventThrottle={32}
      onScroll={event => {
        nearLatest.current = event.nativeEvent.contentOffset.y < event.nativeEvent.layoutMeasurement.height;
      }}
      renderItem={({ item }) => <View>
        {item.date && <Text style={styles.date}>{item.date}</Text>}
        <LoungeMessage history message={item.message} preview={setPreview} reply={reply}
          controller={controller} locate={locate} own={item.message.sender.id === state.user?.id}
          profile={() => profile(item.message.sender)}
          mention={item.message.sender.id !== state.user?.id ? () => mention(item.message.sender) : undefined}
          direct={state.directAvailable && item.message.sender.id !== state.user?.id
            ? () => { close(); direct(item.message.sender); } : undefined} />
      </View>}
      ListHeaderComponent={history.loading === 'newer' ? <HistoryStatus history={history} /> : null}
      ListFooterComponent={history.loading === 'older' ? <HistoryStatus history={history} /> : null} />
    {preview && <LoungePreview uri={preview} close={() => setPreview(undefined)} />}
  </SafeAreaView></Modal>;
}

function HistoryHeader({ history, close }: { history: HistoryTimelineModel; close: () => void }) {
  const styles = useHistoryStyles(), color = useLoungeColor();
  return <>
    <View style={styles.header}>
      <View style={styles.side}><Pressable accessibilityRole="button" accessibilityLabel={t('client.lounge.backToChat')}
        style={styles.back} onPress={close}>
        <Ionicons name="chevron-back" size={22} color={color('#456c96', 'info')} accessible={false} />
        <Text style={styles.backText}>{t('client.lounge.backToChat')}</Text></Pressable></View>
      <Text accessibilityRole="header" style={styles.title}>{t('client.lounge.history')}</Text>
      <View style={styles.side} />
    </View>
    <View style={styles.search}>
      <Ionicons name="search" size={21} color={color('#7a879a', 'muted')} accessible={false} />
      <TextInput value={history.query} onChangeText={history.setQuery} style={styles.input}
        accessibilityLabel={t('client.lounge.searchHistory')} placeholder={t('client.lounge.searchHistory')}
        placeholderTextColor={color('#7a879a', 'muted')} />
    </View>
  </>;
}

function HistoryStatus({ history }: { history: HistoryTimelineModel }) {
  const styles = useHistoryStyles();
  const label = history.error ? 'client.lounge.historyLoadFailed' : history.loading ? 'client.lounge.historyLoading'
    : history.query.trim() ? 'client.lounge.historyNoResults' : 'client.lounge.historyEmpty';
  return <View style={styles.status}>
    {!!history.loading && <ActivityIndicator />}
    <Text accessibilityRole={history.error ? 'alert' : undefined} style={styles.statusText}>{t(label)}</Text>
    {history.error && <Pressable accessibilityRole="button" onPress={history.retry} style={styles.retry}>
      <Text style={styles.backText}>{t('client.lounge.historyRetry')}</Text></Pressable>}
  </View>;
}
