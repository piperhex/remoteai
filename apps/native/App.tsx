import 'react-native-gesture-handler';
import { DeviceStatusConnection } from '../../shared/realtime/deviceStatusConnection';
import { createThemedStyles } from './src/theme/styles';
import { loadTheme, useThemeColor } from './src/theme/preference';
import { ThemeStatusBar } from './src/theme/ThemeStatusBar';
import { t, useLanguage } from './src/i18n';
import { loadLanguage } from './src/i18n/preference';
import { LoginLanguagePicker } from './src/settings/LanguagePicker';
import './src/chat/backgroundConnection';
import { mergeRemoteModelState, type RemoteModelTarget } from '../../shared/remote-chat/modelTarget';
import { Ionicons } from '@expo/vector-icons';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Keyboard,
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
import { useDeviceScreenControl } from './src/devices/useDeviceScreenControl';
import { RemoteModelSwitchSheet } from './src/components/RemoteModelSwitchSheet';
import { QuotaConsumptionSheet } from './src/components/QuotaConsumptionSheet';
import { TotpPage } from './src/totp/TotpPage';
import { downloadOwner } from './src/downloads/manager';
import { BottomNavigation } from './src/discovery/BottomNavigation';
import { MappingProvider } from './src/portMapping/MappingProvider';
import { PortMappingPage } from './src/portMapping/PortMappingPage';
import { DiscoveryBackButton, DiscoveryPage } from './src/discovery/DiscoveryPage';
import { LoungePage } from './src/lounge/LoungePage';
import { useNativeLounge } from './src/lounge/useNativeLounge';
import { isDiscoveryPage } from '../../shared/navigation/discovery';
import { usePageStyles as useTotpPageStyles } from './src/totp/pageStyles';
import { ChatPage } from './src/chat/ChatPage';
import { SshPage } from './src/discovery/SshPage';
import { useDirectSsh } from './src/ssh/useDirectSsh';
import { PrimaryPagePager } from './src/navigation/PrimaryPagePager';
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
    <Text style={styles.startupErrorTitle}>{t("client.mobile.couldNotStartTheApp")}</Text>
    <Text style={styles.startupErrorMessage}>{t("client.mobile.closeTheAppAndTryAgainIfTheProblemContinues")}</Text>
    <Text selectable style={styles.startupErrorDetail}>{error.message}</Text>
  </SafeAreaView>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : t("client.mobile.somethingWentWrongTryAgainLater");
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
      Toast.fail(t("client.mobile.couldNotSignIn", { value1: errorMessage(error) }));
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
        <Text style={styles.loginSubtitle}>{t("client.mobile.signInToViewUsageForYourOfficialAccounts")}</Text>
        <LoginLanguagePicker />
        <View style={styles.loginCard}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>{t("client.mobile.cloudServerUrl")}</Text>
            {!usingOfficialServer ? <Pressable accessibilityRole="button" disabled={submitting}
              onPress={() => setBaseUrl(DEFAULT_CLOUD_BASE_URL)} style={({ pressed }) => [styles.officialServerButton, pressed && styles.pressed]}>
              <Text style={styles.officialServerButtonText}>{t("client.mobile.useOfficialServer")}</Text>
            </Pressable> : null}
          </View>
          <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false}
            keyboardType="url" placeholder={DEFAULT_CLOUD_BASE_URL} placeholderTextColor={color("#98a9a0", 'muted')}
            style={styles.input} editable={!submitting} />
          <Text style={styles.fieldHint}>{t("client.mobile.enterYourRemoteAiServerSBaseUrl")}</Text>
          <Text style={styles.fieldLabel}>{t("client.app.email")}</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
            autoComplete="email" keyboardType="email-address" placeholder="name@example.com" placeholderTextColor={color("#98a9a0", 'muted')}
            style={styles.input} editable={!submitting} />
          <Text style={styles.fieldLabel}>{t("client.accounts.password")}</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="password"
            placeholder={t("client.mobile.enterPassword")} placeholderTextColor={color("#98a9a0", 'muted')} style={styles.input} editable={!submitting}
            onSubmitEditing={requestLogin} />
          <AgreementConsent consent={consent} disabled={submitting} />
          <Pressable accessibilityRole="button" style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, submitting && styles.disabled]}
            disabled={submitting} onPress={requestLogin}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{t("client.app.signIn")}</Text>}
          </Pressable>
        </View>
        <Text style={styles.securityNote}>{t("client.mobile.yourSignInTokenIsKeptOnlyInThisDevice")}</Text>
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
      <Text style={styles.compactResetText}>{t("client.mobile.primaryUsageWindowUnavailable")}</Text>
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
      {loading ? <View style={styles.loadingBox}><ActivityIndicator size="large" color={color(COLORS.green, 'accent')} /><Text style={styles.loadingText}>{t("client.mobile.loadingAccountOverview")}</Text></View> : null}
      {!loading && accounts.length === 0 ? <View style={styles.emptyBox}>
        <Text style={styles.emptyTitle}>{t("client.mobile.noAccountsToDisplayYet")}</Text>
        <Text style={styles.emptyText}>{t("client.mobile.tapAddAccountAndAuthorizeWithChatgptToViewThe")}</Text>
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
      t("client.mobile.updateDownloaded"),
      t("client.mobile.remoteAiHasDownloadedInstallNow", { value1: downloadState.version }),
      [
        { text: t("client.app.later"), style: 'cancel' },
        {
          text: t("client.mobile.installNow"),
          onPress: () => {
            void installDownloadedAndroidUpdate(downloadState.path)
              .catch((error) => Toast.fail(t("client.mobile.couldNotOpenTheInstaller", { value1: errorMessage(error) })));
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
    title={t("client.mobile.chooseProxySignInAccount")}
    subtitle={device
      ? t("client.mobile.updatesProxySignInOnTheComputerAndRestartsChatgpt", { value1: device.name })
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
        <Text style={styles.switchDeviceEmptyTitle}>{t("client.mobile.noAccountsAvailable")}</Text>
        <Text style={styles.switchDeviceEmptyText}>{t("client.mobile.addAndSyncAnAccountOnYourComputerFirst")}</Text>
      </View> : accounts.map((account) => {
        const current = device?.openaiAuthAccountId === account.id;
        const switching = switchingAccountId === account.id;
        const disabled = Boolean(switchingAccountId) || !device?.online || current;
        return <Pressable
          key={account.id}
          accessibilityRole="button"
          accessibilityLabel={`${account.email}${current ? t("client.mobile.currentProxySignInAccount") : ''}`}
          accessibilityHint={current ? undefined : t("client.mobile.useForProxySignInOnThisDevice")}
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
                <Text style={styles.openAiAuthAccountCurrentText}>{t("client.accounts.current")}</Text>
              </View>
              : null}
        </Pressable>;
      })}
    </ScrollView>
  </BottomSheet>;
}

function DeviceManagementPage({
  onBack,
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
  onBack: () => void;
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
  const onScreenControl = useDeviceScreenControl(session);
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
      t("client.app.removeDevice"),
      t("client.mobile.deleteItWillReappearWhenItNextSignsInOn", { value1: device.name }),
      [
        { text: t("client.accounts.cancel"), style: 'cancel' },
        {
          text: t("client.projectBrowser.deleted"),
          style: 'destructive',
          onPress: () => void onDelete(device.deviceId),
        },
      ],
    );
  }, [deletingDeviceId, onDelete]);

  return <>
    <DeviceManagementList
      onBack={onBack}
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
      onScreenControl={onScreenControl}
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

type AppPage = 'port-mappings' | 'accounts' | 'devices' | 'chat' | 'discover' | 'totp' | 'admin' | 'settings' | 'about'
  | 'token-summary' | 'downloads' | 'lounge' | 'ssh';
const DEFAULT_APP_PAGE: AppPage = 'chat';

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
    title={t("client.mobile.chooseADeviceToSwitch")}
    subtitle={account ? t("client.mobile.switchTo", { value1: account.email }) : undefined}
    onClose={onClose}
    dismissible={!switching}
  >
    <ScrollView style={styles.switchDeviceScroll} showsVerticalScrollIndicator={false}>
      {!devices.length ? <View style={styles.switchDeviceEmpty}>
        <Text style={styles.switchDeviceEmptyTitle}>{t("client.mobile.noDevicesAvailable")}</Text>
        <Text style={styles.switchDeviceEmptyText}>{t("client.mobile.signInToTheSameCloudAccountOnYourComputer")}</Text>
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
            <Text style={styles.switchDeviceMeta}>{device.online ? t("client.chat.online") : t("client.chat.offline")} · {device.platform}</Text>
          </View>
          {pendingDeviceId === device.deviceId
            ? <ActivityIndicator color={color(COLORS.green, 'accent')} size="small" />
            : <View style={[styles.switchDeviceAction, current && styles.switchDeviceActionCurrent]}>
              <Text style={[styles.switchDeviceActionText, current && styles.switchDeviceActionTextCurrent]}>
                {current ? t("client.accounts.current") : device.online ? t("client.accounts.switch") : t("client.mobile.unavailable")}
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
  const openAccounts = useCallback(() => { Keyboard.dismiss(); setActivePage('accounts'); }, []);
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
      if (!quiet && failedCount === 0) Toast.success(t("client.mobile.usageRefreshedForAllAccounts"));
      if (!quiet && failedCount > 0) Toast.fail(t("client.mobile.couldNotRefreshUsageForAccounts", { value1: failedCount }));
    } catch (error) {
      if (!quiet) Toast.fail(t("client.mobile.couldNotRefreshUsage", { value1: errorMessage(error) }));
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
      Toast.success(t("client.mobile.accountUsageRefreshed"));
    } catch (error) {
      Toast.fail(t("client.mobile.couldNotRefreshUsage", { value1: errorMessage(error) }));
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
      Toast.fail(t("client.mobile.noAccountsSupportDirectQuotaConsumptionFromYourPhone"));
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
      if (result.failures.length) issues.push(t("client.mobile.couldNotConsumeQuotaForAccounts", { value1: result.failures.length }));
      if (usageRefreshFailures) issues.push(t("client.mobile.couldNotRefreshUsageForAccounts", { value1: usageRefreshFailures }));
      if (issues.length) {
        const completed = consumedCount ? t("client.mobile.consumedQuotaForAccounts", { value1: consumedCount }) : '';
        Toast.fail(`${completed}${issues.join('，')}`);
      } else {
        Toast.success(t("client.mobile.consumedQuotaAndRefreshedUsageForAccounts", { value1: consumedCount }));
      }
    } catch (error) {
      Toast.fail(t("client.mobile.batchQuotaConsumptionFailed", { value1: errorMessage(error) }));
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
              Toast.fail(t("client.mobile.couldNotSyncCloudDataYouRemainSignedIn"));
            }
          }
        }
      } catch (error) {
        if (isSessionExpiredError(error)) {
          await clearSession();
          if (mounted) setSession(null);
        } else if (mounted) {
          Toast.fail(t("client.mobile.couldNotReadSavedSignInDetailsReopenTheApp"));
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
    let receiveDeviceStatus = createDeviceStatusReceiver();
    const connection = new DeviceStatusConnection({
      url: () => deviceStatusWebSocketUrl(session.baseUrl),
      subscribe: () => deviceStatusSubscriptionMessage(session),
      connecting: () => { receiveDeviceStatus = createDeviceStatusReceiver(); },
      message: data => {
        const message = parseDeviceStatusSocketMessage(data);
        if (!message) return false;
        setDevices(receiveDeviceStatus(message));
        if (message.type === 'devices-snapshot') setDevicesLoaded(true);
        return message.type === 'devices-snapshot';
      },
      recoverAuthentication: async () => {
        try {
          const nextDevices = await fetchRemoteDevices(session);
          if (stopped) return;
          setDevices(nextDevices);
          setDevicesLoaded(true);
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
        }
      },
    });
    connection.setForeground(AppState.currentState === 'active');
    connection.start();
    const subscription = AppState.addEventListener('change', state => connection.setForeground(state === 'active'));
    return () => {
      stopped = true;
      subscription.remove();
      connection.stop();
    };
  }, [session]);

  useEffect(() => {
    // Android's system Back action also covers the edge-swipe gesture. Keep
    // top-level tabs in the app before allowing the Activity to finish.
    if (!session || activePage === DEFAULT_APP_PAGE || activePage === 'admin' || activePage === 'downloads') {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isDiscoveryPage(activePage)) setActivePage('discover');
      else setActivePage(activePage === 'about' ? 'settings' : DEFAULT_APP_PAGE);
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
      .catch((error) => Toast.fail(t("client.mobile.couldNotLoadAccounts", { value1: errorMessage(error) })))
      .finally(() => setLoading(false));
    void fetchRemoteDevices(nextSession)
      .then((nextDevices) => {
        if (sessionRef.current !== nextSession) return;
        setDevices(nextDevices);
        setDevicesLoaded(true);
      })
      .catch((error) => Toast.fail(t("client.mobile.couldNotLoadDevices", { value1: errorMessage(error) })));
    void fetchRemoteProviders(nextSession)
      .then(setProviders)
      .catch((error) => Toast.fail(t("client.mobile.couldNotLoadProviders", { value1: errorMessage(error) })));
    void fetchUserProfile(nextSession)
      .then(setProfile)
      .catch((error) => Toast.fail(t("client.mobile.couldNotLoadUserDetails", { value1: errorMessage(error) })));
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
      Toast.fail(t("client.mobile.signOutOfTheDesktopAppOnThisDeviceBefore"));
      return;
    }

    setDeletingDeviceId(deviceId);
    try {
      await deleteRemoteDevice(session, deviceId);
      setDevices((current) => current.filter((candidate) => candidate.deviceId !== deviceId));
      Toast.success(t("client.app.deviceRemoved"));
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
        Toast.fail(t("client.mobile.couldNotDelete", { value1: errorMessage(error) }));
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
      Toast.success(t("client.app.chatgptCodexRestartedOnTheSelectedComputer"));
    } catch (error) {
      Toast.fail(t("client.mobile.couldNotRestart", { value1: errorMessage(error) }));
    } finally {
      setRestartingDeviceId(null);
    }
  }, [restartingDeviceId, session]);

  const promptModelRestart = useCallback((deviceId: string) => {
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    const canRestartRemotely = device?.capabilities?.includes('restart-codex') ?? false;
    const content = canRestartRemotely
      ? t("client.app.restartChatgptCodexOnThatComputerToFinishSwitchingThe")
      : t("client.app.youSwitchedBetweenAnOfficialModelAndAThirdParty");
    Alert.alert(
      t("client.app.restartToLoadTheCurrentModel"),
      content,
      canRestartRemotely
        ? [
          { text: t("client.app.later"), style: 'cancel' },
          {
            text: t("client.app.restartNow"),
            style: 'destructive',
            onPress: () => void restartCodexOnDevice(deviceId),
          },
        ]
        : [{ text: t("client.app.gotIt") }],
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
      Toast.success(target === 'gui' ? t("client.app.codexGuiModelSwitched") : t("client.app.proxyApiModelSwitched"));
      if (result.requiresRestart) {
        setTimeout(() => promptModelRestart(deviceId), 0);
      }
      return true;
    } catch (error) {
      Toast.fail(t("client.mobile.couldNotSwitch", { value1: errorMessage(error) }));
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
      Toast.success(target === 'gui' ? t("client.app.codexGuiModelSwitched") : t("client.app.proxyApiModelSwitched"));
      if (result.requiresRestart) {
        setTimeout(() => promptModelRestart(deviceId), 0);
      }
      return true;
    } catch (error) {
      Toast.fail(t("client.mobile.couldNotSwitch", { value1: errorMessage(error) }));
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
      Toast.success(t("client.mobile.startedGroupOnTheComputer", { value1: group }));
      if (result.requiresRestart) setTimeout(() => promptModelRestart(deviceId), 0);
      return true;
    } catch (error) {
      Toast.fail(t("client.mobile.couldNotSwitch", { value1: errorMessage(error) }));
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
      Toast.fail(t("client.mobile.theDeviceIsOfflineItsProxySignInAccountCannot"));
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
      Toast.success(t("client.mobile.theComputerSProxySignInAccountWasUpdated"));
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
        Toast.fail(t("client.mobile.couldNotUpdateProxySignIn", { value1: errorMessage(error) }));
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

  const lounge = useNativeLounge(session);
  const directSsh = useDirectSsh(session);
  const showBottomNavigation = !['token-summary', 'downloads', 'lounge'].includes(activePage);
  if (initializing) return <View style={styles.boot}><ThemeStatusBar /><ActivityIndicator size="large" color={color(COLORS.green, 'accent')} /><Text style={styles.bootText}>Remote AI</Text></View>;
  if (!session) return <View style={styles.app}>
    <ThemeStatusBar /><LoginScreen initialBaseUrl={DEFAULT_CLOUD_BASE_URL} onLoggedIn={handleLogin} />
  </View>;
  return <MappingProvider session={session} devices={devices}>
    <SafeAreaView edges={showBottomNavigation ? ['left', 'right'] : ['left', 'right', 'bottom']}
    style={[styles.app, activePage === 'totp' && totpPageStyles.page,
    activePage === 'accounts' && accountStyles.page,
    (activePage === 'discover' || activePage === 'ssh') && styles.discoveryCanvas,
    activePage === 'chat' && styles.chatCanvas,
    (activePage === 'settings' || activePage === 'about' || activePage === 'downloads') && styles.settingsCanvas]}>
    <ThemeStatusBar />
    <PrimaryPagePager page={activePage} onChange={setActivePage} pageStyles={{
      chat: activePage === 'token-summary' ? styles.app : styles.chatCanvas,
      accounts: accountStyles.page, discover: styles.discoveryCanvas, settings: styles.settingsCanvas,
    }} pages={{
    chat: <ChatPage session={session} devices={devices}
      active={activePage === 'chat' || activePage === 'token-summary'}
      openAccounts={openAccounts}
      devicesLoaded={devicesLoaded}
      tokenSummary={activePage === 'token-summary'} closeTokenSummary={() => setActivePage('discover')}
      notification={chatNotification.target} notificationError={chatNotification.error}
      notificationHandled={chatNotification.handled} />,
    discover: <DiscoveryPage owner={session ? downloadOwner(session) : undefined}
      loungeUnread={lounge.state.unread} onOpen={setActivePage} />,
    accounts: <Dashboard session={session} accounts={accounts} devices={devices} loading={loading}
        syncingServer={syncingServer} refreshingUsage={refreshingUsage} consumingQuota={consumingQuota}
        refreshingAccountId={refreshingAccountId} switchingAccountId={switchingAccountId}
        onRefreshServer={refreshServerData} onRefreshUsage={refreshAllUsage} onConsumeQuota={consumeSelectedQuota}
        onRefreshAccount={refreshAccount} onSwitch={handleRemoteSwitch}
        onAccountUpdated={(updated) => setAccounts((current) => current.map((account) => (
          account.id === updated.id ? { ...account, ...updated } : account
        )))} />,
    settings: <SettingsPage session={session} profile={profile} globalRefreshMinutes={globalRefreshMinutes}
      loungeController={lounge.controller}
      onGlobalRefreshMinutesChange={handleGlobalRefreshMinutesChange}
      onOpenAbout={() => setActivePage('about')} onOpenAdmin={() => setActivePage('admin')}
      onLogout={handleLogout} totpManager={totpManager} />,
    }}>
    {activePage === 'downloads' && <DownloadManagerPage session={session} onBack={() => setActivePage('discover')} />}
    {activePage === 'ssh' && directSsh && <SshPage client={directSsh} onBack={() => setActivePage('discover')} />}
    {isDiscoveryPage(activePage)
      && !['downloads', 'token-summary', 'lounge', 'port-mappings', 'totp', 'devices', 'ssh'].includes(activePage)
      && <DiscoveryBackButton onBack={() => setActivePage('discover')} />}
    {activePage === 'port-mappings'
      && <PortMappingPage devices={devices} onBack={() => setActivePage('discover')} />}
    {activePage === 'lounge' && <LoungePage controller={lounge.controller} onBack={() => setActivePage('discover')} />}
    {activePage === 'devices'
        ? <DeviceManagementPage session={session} accounts={accounts} providers={providers} devices={devices}
          onBack={() => setActivePage('discover')}
          refreshing={syncingServer} deletingDeviceId={deletingDeviceId}
          switchingAccountId={switchingAccountId} switchingProvider={switchingProvider}
          switchingOpenAiAuth={switchingOpenAiAuth} onRefresh={refreshServerData}
          onDelete={handleDeleteDevice} onSwitchAccount={handleRemoteSwitch}
          onSwitchProvider={handleRemoteProviderSwitch}
          onSwitchProviderGroup={handleRemoteProviderGroupSwitch}
          onSetOpenAiAuthAccount={handleSetOpenAiAuthAccount} />
        : activePage === 'totp'
          ? <TotpPage manager={totpManager} onBack={() => setActivePage('discover')} />
          : activePage === 'admin' && profile?.role === 'admin'
            ? <AdminArea session={session} profile={profile} onExit={() => setActivePage('settings')} />
            : activePage === 'about'
              ? <AboutPage onBack={() => setActivePage('settings')} />
              : null}
    </PrimaryPagePager>
    {showBottomNavigation && <BottomNavigation activePage={activePage}
      owner={session ? downloadOwner(session) : undefined} loungeUnread={lounge.state.unread} onChange={setActivePage} />}
  </SafeAreaView></MappingProvider>;
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
  discoveryCanvas: { backgroundColor: color('#ededed', 'canvas') },
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
}));
