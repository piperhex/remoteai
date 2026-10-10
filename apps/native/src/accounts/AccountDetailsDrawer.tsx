import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { AccountPrivateDetailsSheet } from '../components/AccountPrivateDetailsSheet';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView } from '../components/SheetScrollView';
import type { AccountSummary, AuthSession, RemoteDevice } from '../types';
import { AccountInfoCard } from './AccountInfoCard';
import { AccountUsageSection, type UsageHelp } from './AccountUsageSection';
import { detailColors as colors, useDetailStyles as useStyles } from './detailStyles';
import { maskEmail } from './formatters';
import { ResetCreditsDrawer } from './ResetCreditsDrawer';
import { useResetCredits } from './useResetCredits';

interface AccountDetailsProps {
  account: AccountSummary;
  session: AuthSession;
  devices: RemoteDevice[];
  privateMode: boolean;
  refreshing: boolean;
  syncing: boolean;
  switchBusy: boolean;
  switching: boolean;
  onClose: () => void;
  onOpenSwitch: (account: AccountSummary) => void;
  onRefresh: (accountId: string) => Promise<void>;
  onRefreshServer: () => Promise<void>;
  onAccountUpdated: (account: AccountSummary) => void;
}

type DetailsPanel = 'overview' | 'edit' | 'credits' | 'note' | UsageHelp;

function AccountSwitchButton({ account, privateMode, switchBusy, switching, onOpenSwitch }: Pick<AccountDetailsProps,
  'account' | 'privateMode' | 'switchBusy' | 'switching' | 'onOpenSwitch'>) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const email = privateMode ? maskEmail(account.email) : account.email;
  return <Pressable accessibilityRole="button" accessibilityLabel={t("将官方客户端切换到账号 {value1}", { value1: email })}
    accessibilityHint={t("选择要切换账号的电脑")}
    accessibilityState={{ disabled: switchBusy, busy: switching }} disabled={switchBusy}
    onPress={() => onOpenSwitch(account)}
    style={({ pressed }) => [styles.switchButton, pressed && styles.pressed, switchBusy && styles.disabled]}>
    {switching ? <ActivityIndicator color={color(colors.green, 'accent')} size="small" /> : <>
      <Ionicons name="sync-outline" size={21} color={color(colors.green, 'accent')} />
      <Text style={styles.switchText}>{t("切换官方客户端账号")}</Text>
    </>}
  </Pressable>;
}

function AccountIdentity({ account, devices, privateMode, refreshing, onRefresh }: Pick<AccountDetailsProps,
  'account' | 'devices' | 'privateMode' | 'refreshing'> & { onRefresh: () => void }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const active = devices.filter((device) => !device.activeProviderId && device.activeAccountId === account.id);
  const email = privateMode ? maskEmail(account.email) : account.email;
  return <View style={styles.hero}>
    <View style={styles.avatar}><Text style={styles.initials}>{account.email.slice(0, 2).toUpperCase()}</Text></View>
    <View style={styles.identity}>
      <Text style={styles.email} numberOfLines={1}>{email}</Text>
      <Text style={styles.status}>{active.length
        ? t("{value1} 正在使用", { value1: active.map((device) => device.name).join('、') }) : t("当前没有设备使用此账号")}</Text>
      <View style={styles.badge}><Text style={styles.plan}>{account.plan || 'ChatGPT'}</Text></View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={t("刷新账号状态")} disabled={refreshing}
      onPress={onRefresh} style={({ pressed }) => [styles.refresh,
        pressed && styles.pressed, refreshing && styles.disabled]}>
      <View style={styles.refreshCircle}>{refreshing ? <ActivityIndicator color={color(colors.green, 'accent')} />
        : <Ionicons name="sync" size={23} color={color(colors.green, 'accent')} />}</View>
      <Text style={styles.refreshCaption}>{t("刷新状态")}</Text>
    </Pressable>
  </View>;
}

function DetailMessage({ panel, note, onClose }: { panel: DetailsPanel; note: string; onClose: () => void }) {
  const styles = useStyles();
  useLanguage();
  const visible = panel === 'note' || panel === 'primary' || panel === 'secondary';
  const title = panel === 'note' ? t("账号备注") : t("{value1}用量窗口", { value1: panel === 'primary' ? '主' : '次' });
  return <BottomSheet visible={visible} title={title} onClose={onClose} onBack={onClose}
    fullWidthContent dragFromHeaderOnly>
    <SheetScrollView contentContainerStyle={styles.messageContent}>
      <Text selectable style={styles.note}>{panel === 'note' ? (note || t("还没有备注"))
        : t("这里显示该用量窗口的剩余额度和重置时间。不同套餐的窗口时长可能不同，请以账号返回的用量为准。")}</Text>
    </SheetScrollView>
  </BottomSheet>;
}

function AccountDetailsContent(props: AccountDetailsProps) {
  const styles = useStyles();
  useLanguage();
  const { account, onClose, onRefresh, onRefreshServer } = props;
  const [panel, setPanel] = useState<DetailsPanel>('overview');
  const credits = useResetCredits(account);
  const overview = panel === 'overview';
  const returnToOverview = () => setPanel('overview');
  const refresh = () => { void onRefresh(account.id); void credits.reload(); };
  const edit = () => { setPanel('edit'); void onRefreshServer(); };
  return <>
    <BottomSheet visible={overview} title={t("账号详情")} subtitle={t("查看账号的使用情况与配置信息")}
      onClose={onClose} tall fullWidthContent dragFromHeaderOnly>
      <SheetScrollView contentContainerStyle={styles.content}>
        <AccountIdentity {...props} onRefresh={refresh} />
        <AccountUsageSection usage={account.usage} refreshing={props.refreshing}
          onRefresh={refresh} onHelp={setPanel} />
        <AccountInfoCard account={account} credits={credits} active={overview} onEdit={edit}
          onNote={() => setPanel('note')} onCredits={() => setPanel('credits')} />
        <AccountSwitchButton {...props} />
      </SheetScrollView>
    </BottomSheet>
    <AccountPrivateDetailsSheet account={panel === 'edit' ? account : null} session={props.session}
      syncing={props.syncing} onClose={returnToOverview} onUpdated={props.onAccountUpdated} />
    <ResetCreditsDrawer account={account} visible={panel === 'credits'} credits={credits}
      privateMode={props.privateMode} onClose={returnToOverview} onConsumed={onRefreshServer} />
    <DetailMessage panel={panel} note={account.note} onClose={returnToOverview} />
  </>;
}

export function AccountDetailsDrawer(props: Omit<AccountDetailsProps, 'account'> & { account: AccountSummary | null }) {
  useLanguage();
  if (!props.account) return null;
  return <AccountDetailsContent {...props} account={props.account} key={props.account.id} />;
}
