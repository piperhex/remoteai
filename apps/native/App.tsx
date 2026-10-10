import 'react-native-gesture-handler';
import { createThemedStyles } from './src/theme/styles';
import { loadTheme, useThemeMode, useThemeColor } from './src/theme/preference';
import { t, useLanguage } from './src/i18n';
import { loadLanguage } from './src/i18n/preference';
import { LoginLanguagePicker } from './src/settings/LanguageSheet';
import './src/chat/backgroundConnection';
import { mergeRemoteModelState, type RemoteModelTarget } from '../../shared/remote-chat/modelTarget';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  clearSession,
  DEFAULT_GLOBAL_REFRESH_MINUTES,
  DEFAULT_CLOUD_BASE_URL,
  deleteRemoteDevice,
  fetchAccountSummary,
  fetchAccountUsage,
  fetchAccountUsageSummaries,
  fetchRemoteDevices,
  fetchRemoteProviders,
  fetchUserProfile,
  isSessionExpiredError,
  loadGlobalRefreshMinutes,
  loadSession,
  login,
  restartRemoteDeviceCodex,
  saveGlobalRefreshMinutes,
  setRemoteDeviceOpenAiAuthAccount,
  switchRemoteDeviceAccount,
  switchRemoteDeviceProvider,
  switchRemoteDeviceProviderGroup,
} from './src/api/client';
import {
  consumeAccountsQuota,
  quotaConsumptionTargets,
} from './src/api/quotaConsumption';
import type {
  AccountSummary,
  AuthSession,
  RemoteDevice,
  RemoteModelSwitchResult,
  RemoteProviderSummary,
  UsageWindow,
  UserProfile,
} from './src/types';
import { useMobileTelemetry } from './src/useMobileTelemetry';
import { mergeRefreshedUsage, mergeServerAccounts } from './src/utils/accounts';
import { AccountCard } from './src/accounts/AccountCard';
import { AccountOverview, AccountToolbar } from './src/accounts/AccountOverview';
import { displayDate, maskEmail, resetLabel } from './src/accounts/formatters';
import { useStyles as useAccountStyles } from './src/accounts/styles';
import { AdminArea } from './src/admin/AdminArea';
import { AccountDetailsDrawer } from './src/accounts/AccountDetailsDrawer';
import { AddAccountSheet } from './src/components/AddAccountSheet';
import { AppToastHost, Toast } from './src/components/AppToast';
import { BottomSheet } from './src/components/BottomSheet';
import { DeviceManagementList } from './src/devices/DeviceManagementList';
import { useRevokeDesktopService } from './src/devices/useRevokeDesktopService';
import { RemoteModelSwitchSheet } from './src/components/RemoteModelSwitchSheet';
import { QuotaConsumptionSheet } from './src/components/QuotaConsumptionSheet';
import { TotpPage } from './src/totp/TotpPage';
import { usePageStyles as useTotpPageStyles } from './src/totp/pageStyles';
import { ChatPage } from './src/chat/ChatPage';
import { palette as chatPalette } from './src/chat/styles';
import { useChatNotificationNavigation } from './src/chat/useChatNotificationNavigation';
import { SettingsPage } from './src/settings/SettingsPage';
import { DownloadManagerPage } from './src/downloads/DownloadManagerPage';
import { useTotpVault } from './src/totp/useTotpVault';
import {
  createDeviceStatusReceiver,
  deviceStatusSubscriptionMessage,
  deviceStatusWebSocketUrl,
  parseDeviceStatusSocketMessage,
} from './src/realtime/deviceStatus';
import { installDownloadedAndroidUpdate } from './src/update/appUpdate';
import { useAndroidUpdateDownloadState } from './src/update/useAndroidUpdateDownloadState';
import { StartupUpdatePrompt } from './src/update/StartupUpdatePrompt';
import { useIdleAppUpdate } from './src/update/useIdleAppUpdate';
import { AboutPage } from './src/about/AboutPage';
import { AgreementConsent } from './src/auth/AgreementConsent';
import { useAgreementConsent } from '../../shared/legal/useAgreementConsent';

const COLORS = {
  ink: '#13231c',
  muted: '#6f8177',
  border: '#dce8df',
  canvas: '#f7faf7',
  card: '#ffffff',
  green: '#18af8c',
  cyan: '#20b4cf',
  paleGreen: '#e6f8f1',
  paleBlue: '#e8f8fb',
  danger: '#dc5c55',
};

class StartupErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Remote AI startup error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <StartupError error={this.state.error} />;
  }
}

function StartupError({ error }: { error: Error }) {
  const styles = useStyles();
  return <SafeAreaView style={styles.startupError}>
    <Text style={styles.startupErrorTitle}>{t("应用启动失败")}</Text>
    <Text style={styles.startupErrorMessage}>{t("请关闭应用后重试；若问题持续，请重新安装最新版本。")}</Text>
    <Text selectable style={styles.startupErrorDetail}>{error.message}</Text>
  </SafeAreaView>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : t("发生未知错误，请稍后重试");
}

function applyRemoteModelSwitch(
  devices: RemoteDevice[],
  result: RemoteModelSwitchResult,
): RemoteDevice[] {
  return devices.map((device) => device.deviceId === result.deviceId
    ? {
      ...mergeRemoteModelState(device, result),
      online: result.online,
      lastSeenAt: new Date().toISOString(),
    }
    : device);
}

function usageColor(remaining: number) {
  if (remaining <= 15) return COLORS.danger;
  if (remaining <= 40) return '#d89a32';
  return COLORS.cyan;
}

function LoginScreen({ initialBaseUrl, onLoggedIn }: { initialBaseUrl: string; onLoggedIn: (session: AuthSession) => void }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const consent = useAgreementConsent();
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const usingOfficialServer = baseUrl.trim().replace(/\/+$/, '').toLowerCase() === DEFAULT_CLOUD_BASE_URL.toLowerCase();

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      const session = await login(baseUrl, email, password);
      onLoggedIn(session);
    } catch (error) {
      Toast.fail(t("无法登录：{value1}", { value1: errorMessage(error) }));
    } finally {
      setSubmitting(false);
    }
  }, [baseUrl, email, onLoggedIn, password]);

  const requestLogin = () => {
    if (!submitting) void consent.request('login', submit);
  };

  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.select({ ios: 'padding', android: undefined })}>
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoMark}><Text style={styles.logoGlyph}>↺</Text></View>
        <Text style={styles.loginTitle}>Remote AI</Text>
        <Text style={styles.loginSubtitle}>{t("登录后查看你的官方账号用量")}</Text>
        <LoginLanguagePicker />
        <View style={styles.loginCard}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>{t("云端服务器地址")}</Text>
            {!usingOfficialServer ? <Pressable accessibilityRole="button" disabled={submitting}
              onPress={() => setBaseUrl(DEFAULT_CLOUD_BASE_URL)} style={({ pressed }) => [styles.officialServerButton, pressed && styles.pressed]}>
              <Text style={styles.officialServerButtonText}>{t("使用官方服务器")}</Text>
            </Pressable> : null}
          </View>
          <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false}
            keyboardType="url" placeholder={DEFAULT_CLOUD_BASE_URL} placeholderTextColor={color("#98a9a0", 'muted')}
            style={styles.input} editable={!submitting} />
          <Text style={styles.fieldHint}>{t("填写部署 Remote AI 后端的根地址")}</Text>
          <Text style={styles.fieldLabel}>{t("邮箱")}</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
            autoComplete="email" keyboardType="email-address" placeholder="name@example.com" placeholderTextColor={color("#98a9a0", 'muted')}
            style={styles.input} editable={!submitting} />
          <Text style={styles.fieldLabel}>{t("密码")}</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="password"
            placeholder={t("输入密码")} placeholderTextColor={color("#98a9a0", 'muted')} style={styles.input} editable={!submitting}
            onSubmitEditing={requestLogin} />
          <AgreementConsent consent={consent} disabled={submitting} />
          <Pressable accessibilityRole="button" style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, submitting && styles.disabled]}
            disabled={submitting} onPress={requestLogin}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{t("登录并查看")}</Text>}
          </Pressable>
        </View>
        <Text style={styles.securityNote}>{t("登录令牌仅保存于本机的系统安全存储中。")}</Text>
      </ScrollView>
    </SafeAreaView>
  </KeyboardAvoidingView>;
}

function CompactPrimaryUsage({ usage }: { usage?: UsageWindow | null }) {
  const styles = useStyles();
  useLanguage();
  if (!usage) {
    return <>
      <View style={styles.compactUsageRow}>
        <View style={styles.compactProgressTrack} />
        <Text style={styles.compactUsageUnavailable}>--</Text>
      </View>
      <Text style={styles.compactResetText}>{t("主用量窗口暂不可用")}</Text>
    </>;
  }
  const remaining = Math.max(0, Math.min(100, Math.round(usage.remainingPercent)));
  return <>
    <View style={styles.compactUsageRow}>
      <View style={styles.compactProgressTrack}>
        <View style={[styles.progressFill, { width: `${remaining}%`, backgroundColor: usageColor(remaining) }]} />
      </View>
      <Text style={[styles.compactRemaining, { color: usageColor(remaining) }]}>{remaining}%</Text>
    </View>
    <Text style={styles.compactResetText} numberOfLines={1}>{resetLabel(usage.resetsAt)}</Text>
  </>;
}

function AccountCardContent({
  account,
  privateMode,
}: {
  account: AccountSummary;
  privateMode: boolean;
}) {
  const styles = useStyles();
  useLanguage();
  const email = privateMode ? maskEmail(account.email) : account.email;
  return <View style={styles.compactAccountContent}>
    <View style={styles.compactAccountHeader}>
      <View style={styles.compactPlanBadge}>
        <Text style={styles.compactPlanText} numberOfLines={1}>{account.plan || 'ChatGPT'}</Text>
      </View>
      <Text style={styles.compactAccountEmail} numberOfLines={1}>{email}</Text>
    </View>
    <CompactPrimaryUsage usage={account.usage.primary} />
  </View>;
}

function Dashboard({
  session,
  accounts,
  devices,
  loading,
  syncingServer,
  refreshingUsage,
  consumingQuota,
  refreshingAccountId,
  switchingAccountId,
  onRefreshServer,
  onRefreshUsage,
  onConsumeQuota,
  onRefreshAccount,
  onSwitch,
  onAccountUpdated,
}: {
  session: AuthSession;
  accounts: AccountSummary[];
  devices: RemoteDevice[];
  loading: boolean;
  syncingServer: boolean;
  refreshingUsage: boolean;
  consumingQuota: boolean;
  refreshingAccountId: string | null;
  switchingAccountId: string | null;
  onRefreshServer: () => Promise<void>;
  onRefreshUsage: () => Promise<void>;
  onConsumeQuota: (accountIds: string[]) => Promise<void>;
  onRefreshAccount: (accountId: string) => Promise<void>;
  onSwitch: (deviceId: string, accountId: string) => Promise<boolean>;
  onAccountUpdated: (account: AccountSummary) => void;
}) {
  const accountStyles = useAccountStyles();
  const color = useThemeColor();
  const styles = useStyles();
  useLanguage();
  const [privateMode, setPrivateMode] = useState(true);
  const [detailAccountId, setDetailAccountId] = useState<string | null>(null);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [switchAccount, setSwitchAccount] = useState<AccountSummary | null>(null);
  const [quotaConsumptionOpen, setQuotaConsumptionOpen] = useState(false);
  const detailAccount = accounts.find((account) => account.id === detailAccountId) ?? null;
  const latestUpdate = useMemo(() => {
    const timestamps = accounts.map((account) => account.usage.fetchedAt).filter(Boolean).sort();
    return timestamps.length ? timestamps[timestamps.length - 1] : null;
  }, [accounts]);
  const consumableQuotaCount = quotaConsumptionTargets(accounts).length;
  const refreshBusy = syncingServer || refreshingUsage || consumingQuota || Boolean(refreshingAccountId);
  return <>
    <ScrollView style={accountStyles.page} contentContainerStyle={accountStyles.scroll}
      refreshControl={<RefreshControl refreshing={syncingServer}
        onRefresh={() => void onRefreshServer()} tintColor={color(COLORS.green, 'accent')} />}>
      <AccountOverview accountCount={accounts.length}
        onlineDeviceCount={devices.filter((device) => device.online).length}
        refreshBusy={refreshBusy} refreshingUsage={refreshingUsage} consumingQuota={consumingQuota}
        canConsumeQuota={consumableQuotaCount > 0} privateMode={privateMode}
        onTogglePrivacy={() => setPrivateMode((current) => !current)}
        onRefreshUsage={() => void onRefreshUsage()} onConsumeQuota={() => setQuotaConsumptionOpen(true)} />
      <AccountToolbar updatedAt={displayDate(latestUpdate)} onAddAccount={() => setAddAccountOpen(true)} />
      {loading ? <View style={styles.loadingBox}><ActivityIndicator size="large" color={color(COLORS.green, 'accent')} /><Text style={styles.loadingText}>{t("正在读取账户概览…")}</Text></View> : null}
      {!loading && accounts.length === 0 ? <View style={styles.emptyBox}>
        <Text style={styles.emptyTitle}>{t("还没有可展示的账号")}</Text>
        <Text style={styles.emptyText}>{t("点击“添加账户”，使用 ChatGPT 完成授权后即可查看账号。")}</Text>
      </View> : null}
      {!loading && accounts.map((account) => <AccountCard key={account.id} account={account}
        privateMode={privateMode}
        onOpenDetails={(selectedAccount) => setDetailAccountId(selectedAccount.id)} />)}
    </ScrollView>
    <AccountDetailsDrawer
      account={switchAccount ? null : detailAccount}
      devices={devices}
      privateMode={privateMode}
      refreshing={refreshBusy}
      switchBusy={Boolean(switchingAccountId)}
      switching={switchingAccountId === detailAccount?.id}
      onClose={() => setDetailAccountId(null)}
      onOpenSwitch={setSwitchAccount}
      onRefresh={onRefreshAccount}
      session={session}
      syncing={syncingServer}
      onRefreshServer={onRefreshServer}
      onAccountUpdated={onAccountUpdated}
    />
    <DeviceSwitchDrawer
      account={switchAccount}
      devices={devices}
      switching={Boolean(switchingAccountId)}
      onClose={() => setSwitchAccount(null)}
      onSwitch={onSwitch}
    />
    <AddAccountSheet session={session} visible={addAccountOpen}
      onClose={() => setAddAccountOpen(false)} onAdded={onRefreshServer} />
    <QuotaConsumptionSheet
      visible={quotaConsumptionOpen}
      accounts={quotaConsumptionTargets(accounts)}
      concealEmails={privateMode}
      consuming={consumingQuota}
      onClose={() => setQuotaConsumptionOpen(false)}
      onConfirm={onConsumeQuota}
    />
  </>;
}

function AndroidUpdateInstallPrompt() {
  useLanguage();
  const downloadState = useAndroidUpdateDownloadState();
  const promptedVersion = useRef<string | null>(null);

  useEffect(() => {
    if (downloadState.status !== 'downloaded' || promptedVersion.current === downloadState.version) return;
    promptedVersion.current = downloadState.version;
    Alert.alert(
      t("更新已下载"),
      t("Remote AI {value1} 已下载完成，现在安装吗？", { value1: downloadState.version }),
      [
        { text: t("稍后"), style: 'cancel' },
        {
          text: t("立即安装"),
          onPress: () => {
            void installDownloadedAndroidUpdate(downloadState.path)
              .catch((error) => Toast.fail(t("无法打开系统安装器：{value1}", { value1: errorMessage(error) })));
          },
        },
      ],
    );
  }, [downloadState]);

  return null;
}

function OpenAiAuthAccountDrawer({
  accounts,
  device,
  switchingAccountId,
  onClose,
  onSelect,
}: {
  accounts: AccountSummary[];
  device: RemoteDevice | null;
  switchingAccountId: string | null;
  onClose: () => void;
  onSelect: (deviceId: string, accountId: string) => Promise<boolean>;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const handleSelect = useCallback(async (accountId: string) => {
    if (
      !device
      || !device.online
      || switchingAccountId
      || device.openaiAuthAccountId === accountId
    ) return;
    const switched = await onSelect(device.deviceId, accountId);
    if (switched) onClose();
  }, [device, onClose, onSelect, switchingAccountId]);

  return <BottomSheet
    visible={Boolean(device)}
    title={t("选择代理登录态账号")}
    subtitle={device
      ? t("{value1} · 选择后会更新 PC 代理登录态并重启 ChatGPT/Codex", { value1: device.name })
      : undefined}
    onClose={onClose}
    dismissible={!switchingAccountId}
    tall
  >
    <ScrollView
      style={styles.openAiAuthAccountScroll}
      contentContainerStyle={styles.openAiAuthAccountScrollContent}
      showsVerticalScrollIndicator={false}
    >
      {!accounts.length ? <View style={styles.switchDeviceEmpty}>
        <Text style={styles.switchDeviceEmptyTitle}>{t("暂无可选账号")}</Text>
        <Text style={styles.switchDeviceEmptyText}>{t("请先在桌面端添加并同步账号。")}</Text>
      </View> : accounts.map((account) => {
        const current = device?.openaiAuthAccountId === account.id;
        const switching = switchingAccountId === account.id;
        const disabled = Boolean(switchingAccountId) || !device?.online || current;
        return <Pressable
          key={account.id}
          accessibilityRole="button"
          accessibilityLabel={`${account.email}${current ? t("，当前代理登录态账号") : ''}`}
          accessibilityHint={current ? undefined : t("设为这台设备的代理登录态账号")}
          accessibilityState={{ disabled, selected: current }}
          disabled={disabled}
          onPress={() => void handleSelect(account.id)}
          style={({ pressed }) => [
            styles.accountCard,
            current && styles.openAiAuthAccountCardCurrent,
            pressed && styles.accountCardPressed,
            disabled && !current && styles.disabled,
          ]}
        >
          <AccountCardContent account={account} privateMode={false} />
          {switching
            ? <ActivityIndicator color={color(COLORS.green, 'accent')} size="small" />
            : current
              ? <View style={styles.openAiAuthAccountCurrentBadge}>
                <Text style={styles.openAiAuthAccountCurrentText}>{t("当前")}</Text>
              </View>
              : null}
        </Pressable>;
      })}
    </ScrollView>
  </BottomSheet>;
}

function DeviceManagementPage({
  session,
  accounts,
  providers,
  devices,
  refreshing,
  deletingDeviceId,
  switchingAccountId,
  switchingProvider,
  switchingOpenAiAuth,
  onRefresh,
  onDelete,
  onSwitchAccount,
  onSwitchProvider,
  onSwitchProviderGroup,
  onSetOpenAiAuthAccount,
}: {
  session: AuthSession;
  accounts: AccountSummary[];
  providers: RemoteProviderSummary[];
  devices: RemoteDevice[];
  refreshing: boolean;
  deletingDeviceId: string | null;
  switchingAccountId: string | null;
  switchingProvider: { deviceId: string; providerId: string } | null;
  switchingOpenAiAuth: { deviceId: string; accountId: string } | null;
  onRefresh: () => Promise<void>;
  onDelete: (deviceId: string) => Promise<void>;
  onSwitchAccount: (deviceId: string, accountId: string, target?: RemoteModelTarget) => Promise<boolean>;
  onSwitchProvider: (deviceId: string, providerId: string, target?: RemoteModelTarget) => Promise<boolean>;
  onSwitchProviderGroup: (deviceId: string, group: string) => Promise<boolean>;
  onSetOpenAiAuthAccount: (deviceId: string, accountId: string) => Promise<boolean>;
}) {
  useLanguage();
  const revokeService = useRevokeDesktopService(session);
  const [openAiAuthDeviceId, setOpenAiAuthDeviceId] = useState<string | null>(null);
  const [modelDeviceId, setModelDeviceId] = useState<string | null>(null);
  const sortedDevices = useMemo(() => [...devices].sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1;
    return new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
  }), [devices]);
  const openAiAuthDevice = devices.find(
    (device) => device.deviceId === openAiAuthDeviceId,
  ) ?? null;
  const modelDevice = devices.find((device) => device.deviceId === modelDeviceId) ?? null;

  const confirmDelete = useCallback((device: RemoteDevice) => {
    if (device.online || deletingDeviceId) return;
    Alert.alert(
      t("删除设备"),
      t("确定删除“{value1}”吗？删除后，该设备下次登录桌面端时会重新出现在这里。", { value1: device.name }),
      [
        { text: t("取消"), style: 'cancel' },
        {
          text: t("删除"),
          style: 'destructive',
          onPress: () => void onDelete(device.deviceId),
        },
      ],
    );
  }, [deletingDeviceId, onDelete]);

  return <>
    <DeviceManagementList
      devices={sortedDevices}
      accounts={accounts}
      providers={providers}
      refreshing={refreshing}
      deletingDeviceId={deletingDeviceId}
      switchingModelDeviceId={switchingProvider?.deviceId ?? (switchingAccountId ? modelDeviceId : null)}
      switchingAuthDeviceId={switchingOpenAiAuth?.deviceId ?? null}
      onRefresh={onRefresh}
      onDelete={confirmDelete}
      onRevokeService={revokeService}
      onSwitchModel={setModelDeviceId}
      onSelectAuthAccount={setOpenAiAuthDeviceId}
    />
    <OpenAiAuthAccountDrawer
      accounts={accounts}
      device={openAiAuthDevice}
      switchingAccountId={switchingOpenAiAuth
        && switchingOpenAiAuth.deviceId === openAiAuthDevice?.deviceId
        ? switchingOpenAiAuth.accountId
        : null}
      onClose={() => setOpenAiAuthDeviceId(null)}
      onSelect={onSetOpenAiAuthAccount}
    />
    <RemoteModelSwitchSheet
      key={modelDeviceId ?? 'closed'}
      device={modelDevice}
      accounts={accounts}
      providers={providers}
      switchingAccountId={switchingAccountId}
      switchingProviderId={switchingProvider
        && switchingProvider.deviceId === modelDevice?.deviceId
        ? switchingProvider.providerId
        : null}
      onClose={() => setModelDeviceId(null)}
      onSwitchAccount={onSwitchAccount}
      onSwitchProvider={onSwitchProvider}
      onSwitchProviderGroup={onSwitchProviderGroup}
    />
  </>;
}

type AppPage = 'accounts' | 'devices' | 'chat' | 'totp' | 'admin' | 'settings' | 'about'
  | 'token-summary' | 'downloads';
const DEFAULT_APP_PAGE: AppPage = 'chat';

function BottomNavigation({ activePage, onChange }: {
  activePage: AppPage;
  onChange: (page: AppPage) => void;
}) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  const totpPageStyles = useTotpPageStyles();
  useLanguage();
  const settingsActive = ['admin', 'about', 'settings'].includes(activePage);
  // Keep the home-indicator area inside the navigation background.
  return <SafeAreaView edges={['bottom']} style={styles.bottomNavigation} accessibilityRole="tablist">
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: activePage === 'chat' }}
      onPress={() => onChange('chat')} style={styles.navItem}>
      <Ionicons name="chatbubble-outline" size={23} color={activePage === 'chat' ? resolveThemeColor('#00c98b', 'accent') : resolveThemeColor('#858991', 'muted')} />
      <Text style={[styles.navText, activePage === 'chat' && styles.navTextActive]}>{t("聊天")}</Text>
    </Pressable>
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: activePage === 'accounts' }}
      onPress={() => onChange('accounts')} style={styles.navItem}>
      <Ionicons name={activePage === 'accounts' ? 'people' : 'people-outline'}
        size={23} color={activePage === 'accounts' ? resolveThemeColor('#00c98b', 'accent') : resolveThemeColor('#858991', 'muted')} />
      <Text style={[styles.navText, activePage === 'accounts' && styles.navTextActive]}>{t("账号")}</Text>
    </Pressable>
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: activePage === 'devices' }}
      onPress={() => onChange('devices')} style={styles.navItem}>
      <Ionicons name="server-outline" size={23} color={activePage === 'devices' ? resolveThemeColor('#00c98b', 'accent') : resolveThemeColor('#858991', 'muted')} />
      <Text style={[styles.navText, activePage === 'devices' && styles.navTextActive]}>{t("设备")}</Text>
    </Pressable>
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: activePage === 'totp' }}
      onPress={() => onChange('totp')} style={styles.navItem}>
      <View style={activePage === 'totp' ? totpPageStyles.activeTab : totpPageStyles.tab}>
        <Ionicons name={activePage === 'totp' ? 'shield-checkmark' : 'shield-checkmark-outline'}
          size={23} color={activePage === 'totp' ? resolveThemeColor('#008956', 'accent') : resolveThemeColor('#858991', 'muted')} />
        <Text style={[styles.navText, activePage === 'totp' && styles.navTextActive]}>2FA</Text>
      </View>
    </Pressable>
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: settingsActive }}
      onPress={() => onChange('settings')} style={styles.navItem}>
      <Ionicons name="settings" size={23} color={settingsActive ? resolveThemeColor('#00c98b', 'accent') : resolveThemeColor('#858991', 'muted')} />
      <Text style={[styles.navText, settingsActive && styles.navTextActive]}>{t("设置")}</Text>
    </Pressable>
  </SafeAreaView>;
}

function DeviceSwitchDrawer({ account, devices, switching, onClose, onSwitch }: {
  account: AccountSummary | null;
  devices: RemoteDevice[];
  switching: boolean;
  onClose: () => void;
  onSwitch: (deviceId: string, accountId: string) => Promise<boolean>;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);

  const handleSwitch = useCallback(async (deviceId: string) => {
    if (!account || switching) return;
    setPendingDeviceId(deviceId);
    try {
      if (await onSwitch(deviceId, account.id)) onClose();
    } finally {
      setPendingDeviceId(null);
    }
  }, [account, onClose, onSwitch, switching]);

  return <BottomSheet
    visible={Boolean(account)}
    title={t("选择切换设备")}
    subtitle={account ? t("切换到 {value1}", { value1: account.email }) : undefined}
    onClose={onClose}
    dismissible={!switching}
  >
    <ScrollView style={styles.switchDeviceScroll} showsVerticalScrollIndicator={false}>
      {!devices.length ? <View style={styles.switchDeviceEmpty}>
        <Text style={styles.switchDeviceEmptyTitle}>{t("暂无可用设备")}</Text>
        <Text style={styles.switchDeviceEmptyText}>{t("请先在 PC 端登录同一个云端账号并保持应用运行。")}</Text>
      </View> : devices.map((device) => {
        const current = !device.activeProviderId && device.activeAccountId === account?.id;
        const disabled = switching || !device.online || current;
        return <Pressable
          key={device.deviceId}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => void handleSwitch(device.deviceId)}
          style={({ pressed }) => [
            styles.switchDeviceRow,
            current && styles.switchDeviceRowCurrent,
            pressed && styles.pressed,
            disabled && !current && styles.switchDeviceRowDisabled,
          ]}
        >
          <View style={[styles.deviceStatusDot, device.online ? styles.deviceOnline : styles.deviceOffline]} />
          <View style={styles.switchDeviceInfo}>
            <Text style={styles.switchDeviceName} numberOfLines={1}>{device.name}</Text>
            <Text style={styles.switchDeviceMeta}>{device.online ? t("在线") : t("离线")} · {device.platform}</Text>
          </View>
          {pendingDeviceId === device.deviceId
            ? <ActivityIndicator color={color(COLORS.green, 'accent')} size="small" />
            : <View style={[styles.switchDeviceAction, current && styles.switchDeviceActionCurrent]}>
              <Text style={[styles.switchDeviceActionText, current && styles.switchDeviceActionTextCurrent]}>
                {current ? t("当前") : device.online ? t("切换") : t("不可用")}
              </Text>
            </View>}
        </Pressable>;
      })}
    </ScrollView>
  </BottomSheet>;
}

function AppContent() {
  const styles = useStyles();
  const color = useThemeColor();
  const totpPageStyles = useTotpPageStyles();
  const accountStyles = useAccountStyles();
  useLanguage();
  const [session, updateSession] = useState<AuthSession | null>(null);
  const sessionRef = useRef(session);
  const setSession = useCallback((next: AuthSession | null) => {
    setDevicesLoaded(false);
    sessionRef.current = next;
    updateSession(next);
  }, []);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activePage, setActivePage] = useState<AppPage>(DEFAULT_APP_PAGE);
  const openChat = useCallback(() => setActivePage('chat'), []);
  const chatNotification = useChatNotificationNavigation(session, openChat);
  const [initializing, setInitializing] = useState(true);
  useMobileTelemetry(initializing ? null : session?.baseUrl ?? DEFAULT_CLOUD_BASE_URL);
  const [loading, setLoading] = useState(false);
  const [syncingServer, setSyncingServer] = useState(false);
  const [refreshingUsage, setRefreshingUsage] = useState(false);
  const [consumingQuota, setConsumingQuota] = useState(false);
  const [refreshingAccountId, setRefreshingAccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [providers, setProviders] = useState<RemoteProviderSummary[]>([]);
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null);
  const [switchingProvider, setSwitchingProvider] = useState<{
    deviceId: string;
    providerId: string;
  } | null>(null);
  const [switchingOpenAiAuth, setSwitchingOpenAiAuth] = useState<{
    deviceId: string;
    accountId: string;
  } | null>(null);
  const [restartingDeviceId, setRestartingDeviceId] = useState<string | null>(null);
  const [globalRefreshMinutes, setGlobalRefreshMinutes] = useState(DEFAULT_GLOBAL_REFRESH_MINUTES);
  const notifyTotpError = useCallback((message: string) => Toast.fail(message), []);
  const totpManager = useTotpVault(session, notifyTotpError);
  const refreshingRef = useRef(false);
  const refreshingAccountIdRef = useRef<string | null>(null);
  const lastUsageRefreshAtRef = useRef(0);

  const refreshServerData = useCallback(async (activeSession = session, quiet = false) => {
    if (!activeSession || refreshingRef.current || refreshingAccountIdRef.current) return;
    refreshingRef.current = true;
    setSyncingServer(true);
    try {
      const [nextAccounts, nextDevices, nextProviders] = await Promise.all([
        fetchAccountSummary(activeSession),
        fetchRemoteDevices(activeSession),
        fetchRemoteProviders(activeSession),
      ]);
      setAccounts((current) => mergeServerAccounts(current, nextAccounts));
      setDevices(nextDevices);
      setDevicesLoaded(true);
      setProviders(nextProviders);
    } catch (error) {
      if (isSessionExpiredError(error)) {
        setSession(null);
        setProfile(null);
        setAccounts([]);
        setDevices([]);
        setProviders([]);
        setActivePage(DEFAULT_APP_PAGE);
      }
      if (!quiet) Toast.fail(errorMessage(error));
    } finally {
      refreshingRef.current = false;
      setSyncingServer(false);
    }
  }, [session]);

  const refreshAllUsage = useCallback(async (quiet = false) => {
    if (!session || !accounts.length || refreshingRef.current || refreshingAccountIdRef.current) return;
    refreshingRef.current = true;
    setRefreshingUsage(true);
    try {
      const refreshedAccounts = await fetchAccountUsageSummaries(accounts);
      const failedCount = refreshedAccounts.filter((account) => Boolean(account.usage.error)).length;
      setAccounts((current) => mergeRefreshedUsage(current, refreshedAccounts));
      lastUsageRefreshAtRef.current = Date.now();
      if (!quiet && failedCount === 0) Toast.success(t("所有账号用量已刷新"));
      if (!quiet && failedCount > 0) Toast.fail(t("{value1} 个账号用量刷新失败", { value1: failedCount }));
    } catch (error) {
      if (!quiet) Toast.fail(t("刷新用量失败：{value1}", { value1: errorMessage(error) }));
    } finally {
      refreshingRef.current = false;
      setRefreshingUsage(false);
    }
  }, [accounts, session]);

  const refreshAccount = useCallback(async (accountId: string) => {
    if (!session || refreshingRef.current || refreshingAccountIdRef.current) return;
    const account = accounts.find((candidate) => candidate.id === accountId);
    if (!account) return;

    refreshingAccountIdRef.current = accountId;
    setRefreshingAccountId(accountId);
    try {
      const usage = await fetchAccountUsage(account);
      setAccounts((current) => current.map((candidate) => (
        candidate.id === accountId
          ? { ...candidate, plan: usage.plan ?? candidate.plan, usage }
          : candidate
      )));
      Toast.success(t("当前账号用量已刷新"));
    } catch (error) {
      Toast.fail(t("刷新用量失败：{value1}", { value1: errorMessage(error) }));
    } finally {
      refreshingAccountIdRef.current = null;
      setRefreshingAccountId(null);
    }
  }, [accounts, session]);

  const consumeSelectedQuota = useCallback(async (accountIds: string[]) => {
    if (!session || refreshingRef.current || refreshingAccountIdRef.current) return;
    const selectedIdSet = new Set(accountIds);
    const targets = quotaConsumptionTargets(accounts.filter((account) => selectedIdSet.has(account.id)));
    if (!targets.length) {
      Toast.fail(t("没有可从手机直接消耗额度的账号"));
      return;
    }
    refreshingRef.current = true;
    setConsumingQuota(true);
    try {
      const result = await consumeAccountsQuota(targets);
      let usageRefreshFailures = 0;
      if (result.consumedAccounts.length) {
        const refreshedAccounts = await fetchAccountUsageSummaries(result.consumedAccounts);
        usageRefreshFailures = refreshedAccounts.filter((account) => Boolean(account.usage.error)).length;
        setAccounts((current) => mergeRefreshedUsage(current, refreshedAccounts));
        lastUsageRefreshAtRef.current = Date.now();
      }
      const consumedCount = result.consumedAccounts.length;
      const issues: string[] = [];
      if (result.failures.length) issues.push(t("{value1} 个账号消耗额度失败", { value1: result.failures.length }));
      if (usageRefreshFailures) issues.push(t("{value1} 个账号用量刷新失败", { value1: usageRefreshFailures }));
      if (issues.length) {
        const completed = consumedCount ? t("已完成 {value1} 个账号的额度消耗；", { value1: consumedCount }) : '';
        Toast.fail(`${completed}${issues.join('，')}`);
      } else {
        Toast.success(t("已完成 {value1} 个账号的额度消耗并刷新用量", { value1: consumedCount }));
      }
    } catch (error) {
      Toast.fail(t("批量消耗额度失败：{value1}", { value1: errorMessage(error) }));
    } finally {
      refreshingRef.current = false;
      setConsumingQuota(false);
    }
  }, [accounts, session]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [stored, storedRefreshMinutes] = await Promise.all([
          loadSession(),
          loadGlobalRefreshMinutes(),
        ]);
        if (!mounted) return;
        setGlobalRefreshMinutes(storedRefreshMinutes);
        setSession(stored);
        setInitializing(false);
        if (stored) {
          setProfile(stored.profile ?? null);
          setLoading(true);
          const [accountsResult, devicesResult, providersResult, profileResult] = await Promise.allSettled([
            fetchAccountSummary(stored),
            fetchRemoteDevices(stored),
            fetchRemoteProviders(stored),
            fetchUserProfile(stored),
          ]);
          if (!mounted || sessionRef.current !== stored) return;

          const sessionError = [accountsResult, devicesResult, providersResult, profileResult]
            .find((result) => result.status === 'rejected' && isSessionExpiredError(result.reason));
          if (sessionError) {
            setSession(null);
            setProfile(null);
            setAccounts([]);
            setDevices([]);
            setProviders([]);
          } else {
            if (accountsResult.status === 'fulfilled') {
              setAccounts(accountsResult.value);
              lastUsageRefreshAtRef.current = Date.now();
            }
            if (devicesResult.status === 'fulfilled') {
              setDevices(devicesResult.value);
              setDevicesLoaded(true);
            }
            if (providersResult.status === 'fulfilled') setProviders(providersResult.value);
            if (profileResult.status === 'fulfilled') setProfile(profileResult.value);
            if (accountsResult.status === 'rejected'
              || devicesResult.status === 'rejected'
              || providersResult.status === 'rejected'
              || profileResult.status === 'rejected') {
              Toast.fail(t("暂时无法同步云端数据，登录状态已保留"));
            }
          }
        }
      } catch (error) {
        if (isSessionExpiredError(error)) {
          await clearSession();
          if (mounted) setSession(null);
        } else if (mounted) {
          Toast.fail(t("读取本地登录信息失败，请重新打开应用"));
        }
      } finally {
        if (mounted) {
          setLoading(false);
          setInitializing(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    const intervalMilliseconds = globalRefreshMinutes * 60_000;
    const refreshWhenDue = () => {
      if (Date.now() - lastUsageRefreshAtRef.current >= intervalMilliseconds) {
        void refreshAllUsage(true);
      }
    };
    const timer = setInterval(refreshWhenDue, intervalMilliseconds);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshWhenDue();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [globalRefreshMinutes, refreshAllUsage, session]);

  useEffect(() => {
    if (!session) return undefined;
    let stopped = false;
    let foreground = AppState.currentState === 'active';
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let recoveringSession = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };
    const scheduleReconnect = () => {
      if (stopped || !foreground || reconnectTimer || recoveringSession) return;
      const delay = Math.min(15_000, 1_000 * (2 ** reconnectAttempt));
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
    const recoverSessionAndReconnect = async () => {
      if (recoveringSession || stopped) return;
      recoveringSession = true;
      try {
        const nextDevices = await fetchRemoteDevices(session);
        if (stopped) return;
        setDevices(nextDevices);
        setDevicesLoaded(true);
        reconnectAttempt = 0;
      } catch (error) {
        if (isSessionExpiredError(error)) {
          await clearSession();
          if (!stopped) {
            setSession(null);
            setProfile(null);
            setAccounts([]);
            setDevices([]);
            setProviders([]);
            setActivePage(DEFAULT_APP_PAGE);
          }
        }
      } finally {
        recoveringSession = false;
        scheduleReconnect();
      }
    };
    const connect = () => {
      if (stopped || !foreground || socket) return;
      let nextSocket: WebSocket;
      try {
        nextSocket = new WebSocket(deviceStatusWebSocketUrl(session.baseUrl));
      } catch {
        scheduleReconnect();
        return;
      }
      socket = nextSocket;
      const receiveDeviceStatus = createDeviceStatusReceiver();
      nextSocket.onopen = () => {
        if (stopped || !foreground || socket !== nextSocket) {
          nextSocket.close(1000, 'Connection is no longer needed');
          return;
        }
        reconnectAttempt = 0;
        nextSocket.send(deviceStatusSubscriptionMessage(session));
      };
      nextSocket.onmessage = (event) => {
        if (stopped || socket !== nextSocket) return;
        const message = parseDeviceStatusSocketMessage(event.data);
        if (!message) return;
        setDevices(receiveDeviceStatus(message));
        if (message.type === 'devices-snapshot') setDevicesLoaded(true);
      };
      nextSocket.onerror = () => undefined;
      nextSocket.onclose = (event) => {
        if (socket === nextSocket) socket = null;
        if (stopped || !foreground) return;
        if (event.code === 4001) void recoverSessionAndReconnect();
        else scheduleReconnect();
      };
    };

    connect();
    const subscription = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      if (foreground) {
        reconnectAttempt = 0;
        connect();
        return;
      }
      clearReconnectTimer();
      const activeSocket = socket;
      socket = null;
      activeSocket?.close(1000, 'App moved to background');
    });
    return () => {
      stopped = true;
      foreground = false;
      clearReconnectTimer();
      subscription.remove();
      const activeSocket = socket;
      socket = null;
      activeSocket?.close(1000, 'Session ended');
    };
  }, [session]);

  useEffect(() => {
    // Android's system Back action also covers the edge-swipe gesture. Keep
    // top-level tabs in the app before allowing the Activity to finish.
    if (!session || activePage === DEFAULT_APP_PAGE || activePage === 'admin' || activePage === 'downloads') {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setActivePage(activePage === 'about' ? 'settings' : DEFAULT_APP_PAGE);
      return true;
    });
    return () => subscription.remove();
  }, [activePage, session]);

  const handleLogin = useCallback((nextSession: AuthSession) => {
    setSession(nextSession);
    setProfile(nextSession.profile ?? null);
    setActivePage(DEFAULT_APP_PAGE);
    setLoading(true);
    void fetchAccountSummary(nextSession)
      .then((nextAccounts) => {
        setAccounts(nextAccounts);
        lastUsageRefreshAtRef.current = Date.now();
      })
      .catch((error) => Toast.fail(t("读取账户失败：{value1}", { value1: errorMessage(error) })))
      .finally(() => setLoading(false));
    void fetchRemoteDevices(nextSession)
      .then((nextDevices) => {
        if (sessionRef.current !== nextSession) return;
        setDevices(nextDevices);
        setDevicesLoaded(true);
      })
      .catch((error) => Toast.fail(t("读取设备失败：{value1}", { value1: errorMessage(error) })));
    void fetchRemoteProviders(nextSession)
      .then(setProviders)
      .catch((error) => Toast.fail(t("读取 Provider 失败：{value1}", { value1: errorMessage(error) })));
    void fetchUserProfile(nextSession)
      .then(setProfile)
      .catch((error) => Toast.fail(t("读取用户身份失败：{value1}", { value1: errorMessage(error) })));
  }, []);

  const handleGlobalRefreshMinutesChange = useCallback(async (minutes: number) => {
    await saveGlobalRefreshMinutes(minutes);
    setGlobalRefreshMinutes(minutes);
  }, []);

  const handleDeleteDevice = useCallback(async (deviceId: string) => {
    if (!session || deletingDeviceId) return;
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device) return;
    if (device.online) {
      Toast.fail(t("请先退出该设备上的桌面端，再删除设备"));
      return;
    }

    setDeletingDeviceId(deviceId);
    try {
      await deleteRemoteDevice(session, deviceId);
      setDevices((current) => current.filter((candidate) => candidate.deviceId !== deviceId));
      Toast.success(t("设备已删除"));
    } catch (error) {
      if (isSessionExpiredError(error)) {
        await clearSession();
        setSession(null);
        setProfile(null);
        setAccounts([]);
        setDevices([]);
        setProviders([]);
        setActivePage(DEFAULT_APP_PAGE);
      } else {
        Toast.fail(t("删除失败：{value1}", { value1: errorMessage(error) }));
        void fetchRemoteDevices(session).then(setDevices).catch(() => undefined);
      }
    } finally {
      setDeletingDeviceId(null);
    }
  }, [deletingDeviceId, devices, session]);

  const restartCodexOnDevice = useCallback(async (deviceId: string) => {
    if (!session || restartingDeviceId) return;
    setRestartingDeviceId(deviceId);
    try {
      await restartRemoteDeviceCodex(session, deviceId);
      Toast.success(t("目标 PC 上的 ChatGPT/Codex 已重启"));
    } catch (error) {
      Toast.fail(t("重启失败：{value1}", { value1: errorMessage(error) }));
    } finally {
      setRestartingDeviceId(null);
    }
  }, [restartingDeviceId, session]);

  const promptModelRestart = useCallback((deviceId: string) => {
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    const canRestartRemotely = device?.capabilities?.includes('restart-codex') ?? false;
    const content = canRestartRemotely
      ? t("已在官方模型与第三方 Provider 间切换。立即重启目标 PC 上的 ChatGPT/Codex 以加载当前模型。")
      : t("已在官方模型与第三方 Provider 间切换。请在目标 PC 上手动重启 ChatGPT/Codex。");
    Alert.alert(
      t("重启以加载当前模型？"),
      content,
      canRestartRemotely
        ? [
          { text: t("稍后"), style: 'cancel' },
          {
            text: t("立即重启"),
            style: 'destructive',
            onPress: () => void restartCodexOnDevice(deviceId),
          },
        ]
        : [{ text: t("知道了") }],
    );
  }, [devices, restartCodexOnDevice]);

  const handleRemoteSwitch = useCallback(async (
    deviceId: string,
    accountId: string,
    target: RemoteModelTarget = 'proxy',
  ): Promise<boolean> => {
    if (!session || switchingAccountId) return false;
    setSwitchingAccountId(accountId);
    try {
      const result = await switchRemoteDeviceAccount(session, deviceId, accountId, target);
      setDevices((current) => applyRemoteModelSwitch(current, result));
      Toast.success(target === 'gui' ? t("Codex GUI 模型已切换") : t("代理接口模型已切换"));
      if (result.requiresRestart) {
        setTimeout(() => promptModelRestart(deviceId), 0);
      }
      return true;
    } catch (error) {
      Toast.fail(t("切换失败：{value1}", { value1: errorMessage(error) }));
      void fetchRemoteDevices(session).then(setDevices).catch(() => undefined);
      return false;
    } finally {
      setSwitchingAccountId(null);
    }
  }, [promptModelRestart, session, switchingAccountId]);

  const handleRemoteProviderSwitch = useCallback(async (
    deviceId: string,
    providerId: string,
    target: RemoteModelTarget = 'proxy',
  ): Promise<boolean> => {
    if (!session || switchingProvider) return false;
    setSwitchingProvider({ deviceId, providerId });
    try {
      const result = await switchRemoteDeviceProvider(session, deviceId, providerId, target);
      setDevices((current) => applyRemoteModelSwitch(current, result));
      Toast.success(target === 'gui' ? t("Codex GUI 模型已切换") : t("代理接口模型已切换"));
      if (result.requiresRestart) {
        setTimeout(() => promptModelRestart(deviceId), 0);
      }
      return true;
    } catch (error) {
      Toast.fail(t("切换失败：{value1}", { value1: errorMessage(error) }));
      void fetchRemoteDevices(session).then(setDevices).catch(() => undefined);
      return false;
    } finally {
      setSwitchingProvider(null);
    }
  }, [promptModelRestart, session, switchingProvider]);

  const handleRemoteProviderGroupSwitch = useCallback(async (
    deviceId: string,
    group: string,
  ): Promise<boolean> => {
    if (!session || switchingProvider) return false;
    setSwitchingProvider({ deviceId, providerId: `group:${group}` });
    try {
      const result = await switchRemoteDeviceProviderGroup(session, deviceId, group);
      setDevices((current) => applyRemoteModelSwitch(current, result));
      Toast.success(t("PC 端已启动分组“{value1}”", { value1: group }));
      if (result.requiresRestart) setTimeout(() => promptModelRestart(deviceId), 0);
      return true;
    } catch (error) {
      Toast.fail(t("切换失败：{value1}", { value1: errorMessage(error) }));
      void fetchRemoteDevices(session).then(setDevices).catch(() => undefined);
      return false;
    } finally {
      setSwitchingProvider(null);
    }
  }, [promptModelRestart, session, switchingProvider]);

  const handleSetOpenAiAuthAccount = useCallback(async (
    deviceId: string,
    accountId: string,
  ): Promise<boolean> => {
    if (!session || switchingOpenAiAuth) return false;
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device?.online) {
      Toast.fail(t("设备已离线，暂时无法控制代理登录态账号"));
      return false;
    }

    setSwitchingOpenAiAuth({ deviceId, accountId });
    try {
      const result = await setRemoteDeviceOpenAiAuthAccount(session, deviceId, accountId);
      setDevices((current) => current.map((candidate) => candidate.deviceId === deviceId
        ? {
          ...candidate,
          openaiAuthAccountId: result.openaiAuthAccountId,
          online: result.online,
          lastSeenAt: new Date().toISOString(),
        }
        : candidate));
      Toast.success(t("PC 端代理登录态账号已更新"));
      return true;
    } catch (error) {
      if (isSessionExpiredError(error)) {
        await clearSession();
        setSession(null);
        setProfile(null);
        setAccounts([]);
        setDevices([]);
        setProviders([]);
        setActivePage(DEFAULT_APP_PAGE);
      } else {
        Toast.fail(t("更新代理登录态失败：{value1}", { value1: errorMessage(error) }));
        void fetchRemoteDevices(session).then(setDevices).catch(() => undefined);
      }
      return false;
    } finally {
      setSwitchingOpenAiAuth(null);
    }
  }, [devices, session, switchingOpenAiAuth]);

  const handleLogout = useCallback(() => {
    void clearSession();
    setSession(null);
    setProfile(null);
    setAccounts([]);
    setDevices([]);
    setProviders([]);
    setDeletingDeviceId(null);
    setSwitchingProvider(null);
    setSwitchingOpenAiAuth(null);
    setRestartingDeviceId(null);
    setActivePage(DEFAULT_APP_PAGE);
  }, []);

  const showBottomNavigation = activePage !== 'token-summary' && activePage !== 'downloads';
  if (initializing) return <View style={styles.boot}><ThemeStatusBar /><ActivityIndicator size="large" color={color(COLORS.green, 'accent')} /><Text style={styles.bootText}>Remote AI</Text></View>;
  if (!session) return <View style={styles.app}>
    <ThemeStatusBar /><LoginScreen initialBaseUrl={DEFAULT_CLOUD_BASE_URL} onLoggedIn={handleLogin} />
  </View>;
  return <SafeAreaView edges={showBottomNavigation ? ['top', 'left', 'right'] : undefined}
    style={[styles.app, activePage === 'totp' && totpPageStyles.page,
    activePage === 'accounts' && accountStyles.page,
    activePage === 'chat' && styles.chatCanvas,
    (activePage === 'settings' || activePage === 'about' || activePage === 'downloads') && styles.settingsCanvas]}>
    <ThemeStatusBar />
    <ChatPage session={session} devices={devices} active={activePage === 'chat' || activePage === 'token-summary'}
      devicesLoaded={devicesLoaded}
      tokenSummary={activePage === 'token-summary'} openTokenSummary={() => setActivePage('token-summary')}
      closeTokenSummary={() => setActivePage('chat')}
      notification={chatNotification.target} notificationError={chatNotification.error}
      notificationHandled={chatNotification.handled} />
    {activePage === 'downloads' && <DownloadManagerPage session={session} onBack={() => setActivePage('settings')} />}
    {activePage === 'chat' || activePage === 'token-summary' || activePage === 'downloads'
      ? null : activePage === 'accounts'
      ? <Dashboard session={session} accounts={accounts} devices={devices} loading={loading}
        syncingServer={syncingServer} refreshingUsage={refreshingUsage} consumingQuota={consumingQuota}
        refreshingAccountId={refreshingAccountId} switchingAccountId={switchingAccountId}
        onRefreshServer={refreshServerData} onRefreshUsage={refreshAllUsage} onConsumeQuota={consumeSelectedQuota}
        onRefreshAccount={refreshAccount} onSwitch={handleRemoteSwitch}
        onAccountUpdated={(updated) => setAccounts((current) => current.map((account) => (
          account.id === updated.id ? { ...account, ...updated } : account
        )))} />
      : activePage === 'devices'
        ? <DeviceManagementPage session={session} accounts={accounts} providers={providers} devices={devices}
          refreshing={syncingServer} deletingDeviceId={deletingDeviceId}
          switchingAccountId={switchingAccountId} switchingProvider={switchingProvider}
          switchingOpenAiAuth={switchingOpenAiAuth} onRefresh={refreshServerData}
          onDelete={handleDeleteDevice} onSwitchAccount={handleRemoteSwitch}
          onSwitchProvider={handleRemoteProviderSwitch}
          onSwitchProviderGroup={handleRemoteProviderGroupSwitch}
          onSetOpenAiAuthAccount={handleSetOpenAiAuthAccount} />
        : activePage === 'totp'
          ? <TotpPage manager={totpManager} />
          : activePage === 'admin' && profile?.role === 'admin'
            ? <AdminArea session={session} profile={profile} onExit={() => setActivePage('settings')} />
            : activePage === 'about'
              ? <AboutPage onBack={() => setActivePage('settings')} />
              : <SettingsPage session={session} profile={profile} globalRefreshMinutes={globalRefreshMinutes}
                onGlobalRefreshMinutesChange={handleGlobalRefreshMinutesChange}
                onOpenAbout={() => setActivePage('about')}
                onOpenAdmin={() => setActivePage('admin')}
                onOpenDownloads={() => setActivePage('downloads')}
                onLogout={handleLogout}
                totpManager={totpManager} />}
    {showBottomNavigation && <BottomNavigation activePage={activePage} onChange={setActivePage} />}
  </SafeAreaView>;
}

function ThemeStatusBar() {
  const mode = useThemeMode();
  return <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />;
}

export default function App() {
  useLanguage();
  const updateActivity = useIdleAppUpdate();
  const [languageReady, setLanguageReady] = useState(false);
  useEffect(() => { void Promise.all([loadLanguage(), loadTheme()]).finally(() => setLanguageReady(true)); }, []);
  if (!languageReady) return null;
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <View style={{ flex: 1 }} onTouchStart={updateActivity}>
    <StartupErrorBoundary>
      <AndroidUpdateInstallPrompt />
      <StartupUpdatePrompt />
      <AppContent />
    </StartupErrorBoundary>
    <AppToastHost />
    </View>
  </SafeAreaProvider>;
}

const useStyles = createThemedStyles((color) => ({
  settingsCanvas: { backgroundColor: color('#fff', 'surface') },
  chatCanvas: { backgroundColor: color(chatPalette.background, 'canvas') },
  flex: { flex: 1 }, app: { flex: 1, backgroundColor: color(COLORS.canvas, 'canvas') }, boot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: color(COLORS.canvas, 'canvas'), gap: 12 }, bootText: { color: color(COLORS.ink, 'ink'), fontSize: 18, fontWeight: '700' }, startupError: { flex: 1, padding: 28, justifyContent: 'center', backgroundColor: color(COLORS.canvas, 'canvas') }, startupErrorTitle: { color: color(COLORS.ink, 'ink'), fontSize: 22, fontWeight: '800' }, startupErrorMessage: { color: color(COLORS.muted, 'muted'), fontSize: 15, lineHeight: 22, marginTop: 12 }, startupErrorDetail: { color: color(COLORS.danger, 'danger'), fontSize: 12, marginTop: 20 },
  loginScroll: { flexGrow: 1, backgroundColor: color(COLORS.canvas, 'canvas'), padding: 28, justifyContent: 'center' }, logoMark: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#a7e733', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 18, shadowColor: '#4f7915', shadowOpacity: 0.18, shadowRadius: 14, elevation: 4 }, logoGlyph: { color: color('#184122', 'accent'), fontSize: 34, fontWeight: '900' }, loginTitle: { color: color(COLORS.ink, 'ink'), fontSize: 30, fontWeight: '800', textAlign: 'center' }, loginSubtitle: { color: color(COLORS.muted, 'muted'), fontSize: 15, textAlign: 'center', marginTop: 8, marginBottom: 30 }, loginCard: { backgroundColor: color(COLORS.card, 'surface'), borderColor: color(COLORS.border, 'border'), borderWidth: 1, borderRadius: 18, padding: 20, shadowColor: '#314c3d', shadowOpacity: 0.06, shadowRadius: 18, elevation: 2 }, fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 }, fieldLabel: { color: color(COLORS.ink, 'ink'), fontSize: 14, fontWeight: '700', marginBottom: 8, marginTop: 14 }, officialServerButton: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 8, backgroundColor: color(COLORS.paleBlue, 'infoSoft'), marginTop: 6 }, officialServerButtonText: { color: color('#168da2', 'info'), fontWeight: '700', fontSize: 12 }, fieldHint: { color: color(COLORS.muted, 'muted'), fontSize: 12, marginTop: 8 }, input: { height: 48, borderColor: color('#cbdcd0', 'border'), borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, color: color(COLORS.ink, 'ink'), fontSize: 16, backgroundColor: color('#fbfdfb', 'surface') }, primaryButton: { height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 11, backgroundColor: color(COLORS.cyan, 'info'), marginTop: 24, shadowColor: color(COLORS.cyan, 'info'), shadowOpacity: 0.22, shadowRadius: 10, elevation: 3 }, primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 }, pressed: { opacity: 0.82 }, disabled: { opacity: 0.6 }, securityNote: { color: color(COLORS.muted, 'muted'), fontSize: 12, textAlign: 'center', marginTop: 18 },
  loadingBox: { backgroundColor: color(COLORS.card, 'surface'), borderRadius: 16, padding: 38, alignItems: 'center', gap: 14, borderWidth: 1, borderColor: color(COLORS.border, 'border') }, loadingText: { color: color(COLORS.muted, 'muted') }, emptyBox: { backgroundColor: color(COLORS.card, 'surface'), borderRadius: 16, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: color(COLORS.border, 'border') }, emptyTitle: { color: color(COLORS.ink, 'ink'), fontWeight: '800', fontSize: 17 }, emptyText: { color: color(COLORS.muted, 'muted'), textAlign: 'center', marginTop: 9, lineHeight: 20 },
  openAiAuthAccountScroll: { maxHeight: 610 },
  openAiAuthAccountScrollContent: { paddingBottom: 8 },
  openAiAuthAccountCardCurrent: { borderColor: color('#7fd1ba', 'border'), backgroundColor: color('#f0faf6', 'canvas') },
  openAiAuthAccountCurrentBadge: { flexShrink: 0, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: color(COLORS.paleGreen, 'accentSoft'), borderWidth: 1, borderColor: color('#bde8d8', 'border') },
  openAiAuthAccountCurrentText: { color: color('#128368', 'accent'), fontSize: 11, fontWeight: '900' },
  accountCard: { minHeight: 102, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: color(COLORS.card, 'surface'), borderColor: color(COLORS.border, 'border'), borderWidth: 1, borderRadius: 16, paddingVertical: 14, paddingLeft: 16, paddingRight: 14, marginBottom: 12, shadowColor: '#456152', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  accountCardPressed: { backgroundColor: color('#f2f8f4', 'canvas'), borderColor: color('#bcd7c5', 'border') },
  compactAccountContent: { flex: 1, minWidth: 0, justifyContent: 'center' },
  compactAccountHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  compactPlanBadge: { flexShrink: 0, maxWidth: 86, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: color(COLORS.paleGreen, 'accentSoft'), borderWidth: 1, borderColor: color('#bde8d8', 'border') },
  compactPlanText: { color: color('#128368', 'accent'), fontSize: 11, fontWeight: '800' },
  compactAccountEmail: { flex: 1, minWidth: 0, color: color(COLORS.ink, 'ink'), fontWeight: '800', fontSize: 15 },
  compactUsageRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  compactProgressTrack: { flex: 1, height: 7, borderRadius: 10, overflow: 'hidden', backgroundColor: color('#dbe8e0', 'elevated') },
  compactRemaining: { width: 38, textAlign: 'right', fontWeight: '800', fontSize: 12 },
  compactUsageUnavailable: { width: 38, color: color(COLORS.muted, 'muted'), textAlign: 'right', fontSize: 12 },
  compactResetText: { color: color(COLORS.muted, 'muted'), fontSize: 11, marginTop: 8 },
  progressFill: { height: '100%', borderRadius: 10 },
  switchDeviceScroll: { maxHeight: 440, marginBottom: 12 },
  switchDeviceRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: color(COLORS.border, 'border'), borderRadius: 14, backgroundColor: color('#fff', 'surface'), paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10 },
  switchDeviceRowCurrent: { borderColor: color('#8fdccf', 'border'), backgroundColor: color(COLORS.paleBlue, 'infoSoft') },
  switchDeviceRowDisabled: { opacity: 0.58 },
  deviceStatusDot: { width: 9, height: 9, borderRadius: 5 },
  deviceOnline: { backgroundColor: '#32d19b' },
  deviceOffline: { backgroundColor: color('#a8b2ac', 'elevated') },
  switchDeviceInfo: { flex: 1, minWidth: 0 },
  switchDeviceName: { color: color(COLORS.ink, 'ink'), fontSize: 14, fontWeight: '800' },
  switchDeviceMeta: { color: color(COLORS.muted, 'muted'), fontSize: 11, marginTop: 4 },
  switchDeviceAction: { minWidth: 52, height: 30, borderRadius: 8, backgroundColor: color(COLORS.paleBlue, 'infoSoft'), alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  switchDeviceActionCurrent: { backgroundColor: color('#c7eee8', 'accentSoft') },
  switchDeviceActionText: { color: color('#168da2', 'info'), fontSize: 12, fontWeight: '800' },
  switchDeviceActionTextCurrent: { color: color('#14806f', 'accent') },
  switchDeviceEmpty: { minHeight: 150, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color(COLORS.border, 'border'), borderRadius: 14, backgroundColor: color(COLORS.canvas, 'canvas'), padding: 20 },
  switchDeviceEmptyTitle: { color: color(COLORS.ink, 'ink'), fontSize: 16, fontWeight: '800' },
  switchDeviceEmptyText: { color: color(COLORS.muted, 'muted'), fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  settingsTitle: { color: color(COLORS.ink, 'ink'), fontSize: 28, fontWeight: '800' }, settingsSubtitle: { color: color(COLORS.muted, 'muted'), fontSize: 13, marginTop: 4 }, sectionLabel: { color: color(COLORS.muted, 'muted'), fontSize: 13, fontWeight: '700', marginLeft: 3, marginBottom: 9, marginTop: 2 },
  bottomNavigation: {
    flexDirection: 'row', backgroundColor: color(COLORS.card, 'surface'), borderTopWidth: 1, borderTopColor: color(COLORS.border, 'border'),
    shadowColor: '#314c3d', shadowOpacity: 0.08, shadowRadius: 8, elevation: 10,
  },
  navItem: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2 },
  // Give Android room to draw every glyph instead of using the exact intrinsic text width.
  navText: {
    alignSelf: 'stretch', textAlign: 'center', paddingHorizontal: 4, includeFontPadding: true,
    color: color('#7b8c82', 'muted'), fontSize: 11, lineHeight: 18, fontWeight: '700',
  },
  navTextActive: { color: color(COLORS.green, 'accent') },
}));
