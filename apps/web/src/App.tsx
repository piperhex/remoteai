import { DeviceStatusConnection } from '../../../shared/realtime/deviceStatusConnection';
import { displayError } from './i18n/index';
import { getLocale, t, useLanguage } from './i18n';
import type { RemoteModelTarget } from '../../../shared/remote-chat/modelTarget';
import { profileRole } from './i18n/profile';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Form, Input, PullToRefresh, SafeArea, SpinLoading, TabBar, Toast } from "antd-mobile";
import { Dropdown, Tooltip, type MenuProps } from "antd";
import { ChevronRight, CircleGauge, Compass, LayoutDashboard, LogOut, Menu, MonitorCog,
  Download, MessageSquare, PanelLeftClose, PanelLeftOpen, RefreshCw, Server, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { defaultApiBaseUrl, deviceStatusWebSocketUrl, getActiveSession, parseDeviceStatusMessage } from "./api";
import { useAppDispatch, useAppSelector } from "./hooks";
import { bootstrapApp, clearAuthError, clearDataError, deviceSocketMessage, pageChanged, refreshAll,
  removeDevice, setDeviceOpenAiAuthAccount, signIn, signOut, switchDeviceAccount,
  switchDeviceProvider, switchDeviceProviderGroup } from "./store";
import type { AppPage, RemoteDevice } from "./types";
import { AdaptiveSheet } from "./components/AdaptiveSheet";
import { BrandMark } from "./components/BrandMark";
import { RegistrationSheet } from "./components/RegistrationSheet";
import { DeviceManagementList } from "./devices/DeviceManagementList";
import { useDeviceScreenControl } from './devices/useDeviceScreenControl';
import { useRevokeDesktopService } from './devices/useRevokeDesktopService';
import { useRemoteModelRestartPrompt } from "./devices/useRemoteModelRestartPrompt";
import { RemoteModelSwitchSheet } from "./components/RemoteModelSwitchSheet";
import { TotpPage } from "./components/TotpPage";
import { TotpSyncSwitch } from '../../../shared/totp/TotpSyncSwitch';
import { DownloadCountIcon } from './downloads/DownloadCountIcon';
import { DiscoveryBackButton, DiscoveryPage } from './discovery/DiscoveryPage';
import { DiscoveryIcon } from './discovery/DiscoveryIcon';
import { isDiscoveryPage, primaryNavigationPage } from '../../../shared/navigation/discovery';
import { AccountsPage } from "./accounts/AccountsPage";
import { SettingsPage } from "./settings/SettingsPage";
import { DownloadManagerPage } from './downloads/DownloadManagerPage';
import { LoungePage } from '../../../shared/lounge/LoungePage';
import { LoungeIcon } from '../../../shared/lounge/LoungeIcon';
import { useWebLounge } from './lounge/useWebLounge';
import { LoungeAvatar } from '../../../shared/lounge/LoungeAvatar';
import { accountLabel } from '../../../shared/lounge/accountLabel';
import { downloadOwner } from './downloads/manager';
import { loadRefreshMinutes, REFRESH_INTERVAL_EVENT } from "./settings/refreshInterval";
import { useTotpVault } from "./useTotpVault";
import { ChatPage } from "./chat/ChatPage";
import { PrimaryPagePager } from './navigation/PrimaryPagePager';
import type { PrimaryPage } from '../../../shared/navigation/pageSwipe';
import { useDesktopLayout, usePanelVisibility } from "./useDesktopLayout";
import { useChatViewport } from './chat/useChatViewport';
import { AgreementConsent } from '../../../shared/legal/AgreementConsent';
import { useAgreementConsent } from '../../../shared/legal/useAgreementConsent';

const PULL_REFRESH_TEXT = {
  get pulling() { return t("client.accounts.pullToRefresh"); },
  get canRelease() { return t("client.accounts.releaseToRefresh"); },
  get refreshing() { return t("client.accounts.refreshing"); },
  get complete() { return t("client.accounts.refreshed"); },
} as const;

function LoginView() {
  const language = useLanguage();
  const consent = useAgreementConsent();
  const dispatch = useAppDispatch();
  const { submitting, error } = useAppSelector((state) => state.auth);
  const [baseUrl, setBaseUrl] = useState(defaultApiBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);

  const submit = async () => {
    if (submitting) return;
    if (!email.trim() || !password) {
      Toast.show({ icon: "fail", content: t("client.app.enterYourEmailAndPassword") });
      return;
    }
    await consent.request('login', async () => {
      try {
        await dispatch(signIn({ baseUrl, email, password })).unwrap();
        Toast.show({ icon: "success", content: t("client.app.welcomeBack") });
      } catch {
        // The Redux state renders the actionable server error.
      }
    });
  };

  return <main className="login-page">
    <section className="login-story">
      <div className="story-grid" />
      <div className="brand-lockup light"><BrandMark /><b>Remote AI</b></div>
      <div className="story-copy">
        <span className="eyebrow"><Sparkles size={14} />  {t("client.app.everyAccountAtAGlance")}</span>
        <h1>{t("client.app.awayFromYourDesk")}<br />{t("client.app.stillInControl")}</h1>
        <p>{t("client.app.viewAccountUsageCheckYourDevicesAndSwitchDesktopAccounts")}</p>
        <div className="story-points">
          <span><CircleGauge size={17} />  {t("client.app.liveUsage")}</span>
          <span><MonitorCog size={17} />  {t("client.app.remoteControl")}</span>
          <span><ShieldCheck size={17} />  {t("client.app.secureSignIn")}</span>
        </div>
      </div>
      <small>{t("client.app.stayConnectedSwitchFreely")}</small>
    </section>
    <section className="login-panel">
      <div className="mobile-login-brand brand-lockup">
        <BrandMark />
        <b>Remote AI</b><span className="login-web-badge">Web</span>
      </div>
      <div className="login-form-wrap">
        <span className="login-kicker">{t("client.app.cloudDashboard")}</span>
        <h2>{t("client.app.welcomeBack")}</h2>
        <p className="login-intro">{t("client.app.signInToManageYourUsageAndDevicesFromAnywhere")}</p>
        <Form className="login-form" layout="vertical" footer={<div className="login-actions">
          <Button className="login-register" color="primary" fill="outline" size="large"
            type="button" onClick={() => setShowRegistration(true)}>{t("client.app.signUp")}</Button>
          <Button block color="primary" size="large" loading={submitting} disabled={submitting}
            onClick={submit}>{t("client.app.signIn")}</Button>
        </div>}>
          <Form.Item label={t("client.app.email")}>
            <Input value={email} onChange={(value) => { setEmail(value); dispatch(clearAuthError()); }}
              type="email" inputMode="email" autoCapitalize="none"
              aria-label={t("client.app.email")} autoComplete="email" placeholder="name@example.com" clearable />
          </Form.Item>
          <Form.Item label={t("client.accounts.password")}>
            <Input value={password} onChange={(value) => { setPassword(value); dispatch(clearAuthError()); }}
              type="password" aria-label={t("client.accounts.password")} autoComplete="current-password" placeholder={t("client.app.enterYourPassword")}
              onEnterPress={() => void submit()} clearable />
          </Form.Item>
          <button type="button" className="server-toggle" aria-expanded={showServer}
            aria-controls="login-server" onClick={() => setShowServer((value) => !value)}>
            <Server size={15} /> {showServer ? t("client.app.hideServerSettings") : t("client.app.connectToAnotherServer")} <ChevronRight size={14} />
          </button>
          <div id="login-server" hidden={!showServer}>
            {showServer ? <Form.Item label={t("client.app.serverAddress")} help={t("client.app.onlyChangeThisIfYouUseYourOwnServer")}>
              <Input value={baseUrl} onChange={setBaseUrl} type="url" inputMode="url" aria-label={t("client.app.serverAddress")}
                autoCapitalize="none" placeholder="https://api.example.com" clearable />
            </Form.Item> : null}
          </div>
          <AgreementConsent consent={consent} language={language} disabled={submitting} />
          {error ? <div className="form-error" role="alert">{displayError(error)}</div> : null}
        </Form>
        <div className="login-security"><ShieldCheck size={16} /><span>{t("client.app.aSecureConnectionForYourAccounts")}</span></div>
      </div>
    </section>
    <RegistrationSheet open={showRegistration} onClose={() => setShowRegistration(false)} />
  </main>;
}

function DevicesPage() {
  const onScreenControl = useDeviceScreenControl();
  const revokeService = useRevokeDesktopService();
  useLanguage();
  const dispatch = useAppDispatch();
  const {
    accounts,
    providers,
    devices,
    refreshing,
    deletingDeviceId,
    switchingAccountId,
    switchingProvider,
    switchingOpenAiAuth,
  } = useAppSelector((state) => state.data);
  const promptModelRestart = useRemoteModelRestartPrompt();
  const [authDeviceId, setAuthDeviceId] = useState<string | null>(null);
  const [modelDeviceId, setModelDeviceId] = useState<string | null>(null);
  const authDevice = devices.find((item) => item.deviceId === authDeviceId) ?? null;
  const modelDevice = devices.find((item) => item.deviceId === modelDeviceId) ?? null;
  const sorted = useMemo(() => [...devices].sort((left, right) => Number(right.online) - Number(left.online)
    || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)), [devices]);
  const performRefresh = useCallback(async () => {
    try { await dispatch(refreshAll()).unwrap(); }
    catch { /* The global error toast reports the failure. */ }
  }, [dispatch]);

  const deleteDevice = async (device: RemoteDevice) => {
    if (device.online || deletingDeviceId) return;
    const confirmed = await Dialog.confirm({
      title: t("client.app.removeThisDevice"),
      content: t("client.app.willReappearWhenItSignsInToTheDesktopApp", { value1: device.name }),
      confirmText: t("client.app.removeDevice"),
    });
    if (!confirmed) return;
    try {
      await dispatch(removeDevice(device.deviceId)).unwrap();
      Toast.show({ icon: "success", content: t("client.app.deviceRemoved") });
    } catch { /* Global toast */ }
  };

  const switchOfficialModel = async (deviceId: string, accountId: string, target: RemoteModelTarget = 'proxy') => {
    try {
      const result = await dispatch(switchDeviceAccount({ deviceId, accountId, target })).unwrap();
      Toast.show({ icon: "success", content: target === 'gui'
        ? t("client.app.codexGuiModelSwitched") : t("client.app.proxyApiModelSwitched") });
      if (result.result.requiresRestart) {
        window.setTimeout(() => void promptModelRestart(deviceId), 0);
      }
      return true;
    } catch {
      return false;
    }
  };

  const switchProviderModel = async (deviceId: string, providerId: string, target: RemoteModelTarget = 'proxy') => {
    try {
      const result = await dispatch(switchDeviceProvider({ deviceId, providerId, target })).unwrap();
      Toast.show({ icon: "success", content: target === 'gui'
        ? t("client.app.codexGuiModelSwitched") : t("client.app.proxyApiModelSwitched") });
      if (result.result.requiresRestart) {
        window.setTimeout(() => void promptModelRestart(deviceId), 0);
      }
      return true;
    } catch {
      return false;
    }
  };

  const switchProviderGroup = async (deviceId: string, group: string) => {
    try {
      const result = await dispatch(switchDeviceProviderGroup({ deviceId, group })).unwrap();
      Toast.show({ icon: "success", content: t("client.app.startedGroup", { value1: group }) });
      if (result.result.requiresRestart) {
        window.setTimeout(() => void promptModelRestart(deviceId), 0);
      }
      return true;
    } catch {
      return false;
    }
  };

  return <>
    <PullToRefresh onRefresh={performRefresh} renderText={(status) => PULL_REFRESH_TEXT[status]}>
      <DeviceManagementList devices={sorted} accounts={accounts} providers={providers}
        onBack={() => dispatch(pageChanged('discover'))}
        onScreenControl={onScreenControl}
        refreshing={refreshing} onRefresh={performRefresh} deletingDeviceId={deletingDeviceId}
        switchingModelDeviceId={switchingProvider?.deviceId ?? (switchingAccountId ? modelDeviceId : null)}
        switchingAuthDeviceId={switchingOpenAiAuth?.deviceId ?? null}
        onSwitchModel={setModelDeviceId} onSelectAuthAccount={setAuthDeviceId}
        onDelete={(device) => void deleteDevice(device)} onRevokeService={device => void revokeService(device)} />
    </PullToRefresh>
    <RemoteModelSwitchSheet
      key={modelDeviceId ?? 'closed'}
      device={modelDevice}
      accounts={accounts}
      providers={providers}
      switchingAccountId={switchingAccountId}
      switchingProviderId={switchingProvider
        && switchingProvider.deviceId === modelDevice?.deviceId
        ? switchingProvider.providerId : null}
      onClose={() => setModelDeviceId(null)}
      onSwitchAccount={switchOfficialModel}
      onSwitchProvider={switchProviderModel}
      onSwitchProviderGroup={switchProviderGroup}
    />
    <AdaptiveSheet open={Boolean(authDevice)} title={t("client.app.proxySignInAccount")}
      subtitle={authDevice ? t("client.app.selectingAnAccountWillRestartChatgptCodex", { value1: authDevice.name }) : undefined}
      onClose={() => setAuthDeviceId(null)}>
      <div className="select-list account-select-list">{accounts.map((account) => {
        const current = authDevice?.openaiAuthAccountId === account.id;
        return <button type="button" disabled={current || Boolean(switchingOpenAiAuth)} key={account.id}
          onClick={async () => {
            try {
              await dispatch(setDeviceOpenAiAuthAccount({
                deviceId: authDevice!.deviceId,
                accountId: account.id,
              })).unwrap();
              Toast.show({ icon: "success", content: t("client.app.proxySignInUpdated") });
              setAuthDeviceId(null);
            } catch { /* Global toast */ }
          }}>
          <span className="account-initial">{account.email.slice(0, 2).toUpperCase()}</span>
          <span><strong>{account.email}</strong><small>{account.plan || "ChatGPT"}</small></span>
          {current ? <b className="current-pill">{t("client.accounts.current")}</b> : <ChevronRight size={18} />}
        </button>;
      })}</div>
    </AdaptiveSheet>
  </>;
}

const navItems: Array<{ key: AppPage; label: string; icon: typeof LayoutDashboard }> = [
  { key: "chat", get label() { return t("client.app.chat"); }, icon: MessageSquare },
  { key: "accounts", get label() { return t("client.app.accounts"); }, icon: LayoutDashboard },
  { key: "discover", get label() { return t("client.discovery.title"); }, icon: Compass },
  { key: "settings", get label() { return t("client.app.settings"); }, icon: Settings },
];

function AppShell() {
  useLanguage();
  const [menuVisible, setMenuVisible] = usePanelVisibility('main-menu');
  const dispatch = useAppDispatch();
  const { session } = useAppSelector((state) => state.auth);
  const lounge = useWebLounge(session);
  const { page, profile, devices, refreshing, error } = useAppSelector((state) => state.data);
  const desktopLayout = useDesktopLayout();
  useChatViewport(page === 'lounge' && !desktopLayout);
  const lastRefreshRef = useRef(Date.now());
  const totpManager = useTotpVault(session);
  const activeNavigationPage = desktopLayout && page === 'lounge' ? page : primaryNavigationPage(page);
  const changePrimaryPage = useCallback((next: PrimaryPage) => { dispatch(pageChanged(next)); }, [dispatch]);
  const openAccounts = useCallback(() => changePrimaryPage('accounts'), [changePrimaryPage]);

  useEffect(() => {
    if (!error) return;
    Toast.show({ icon: "fail", content: displayError(error) });
    dispatch(clearDataError());
  }, [dispatch, error]);

  useEffect(() => {
    if (!session) return;
    const connection = new DeviceStatusConnection({
      url: () => deviceStatusWebSocketUrl(session.baseUrl),
      subscribe: () => {
        const latest = getActiveSession();
        if (!latest || latest.baseUrl !== session.baseUrl || latest.email !== session.email) {
          connection.stop();
          throw new Error('Subscription session changed');
        }
        return JSON.stringify({ type: 'subscribe-devices', accessToken: latest.accessToken });
      },
      message: data => {
        const message = parseDeviceStatusMessage(data);
        if (message) dispatch(deviceSocketMessage(message));
        return message?.type === 'devices-snapshot';
      },
    });
    connection.start();
    window.addEventListener('online', connection.retryNow);
    return () => {
      window.removeEventListener('online', connection.retryNow);
      connection.stop();
    };
  }, [dispatch, session]);

  useEffect(() => {
    if (!session) return;
    let intervalId: number;
    const schedule = () => {
      window.clearInterval(intervalId);
      intervalId = window.setInterval(() => {
        const minutes = loadRefreshMinutes();
        if (Date.now() - lastRefreshRef.current >= minutes * 60_000) {
          lastRefreshRef.current = Date.now();
          void dispatch(refreshAll());
        }
      }, 60_000);
    };
    schedule();
    window.addEventListener(REFRESH_INTERVAL_EVENT, schedule);
    return () => { window.clearInterval(intervalId); window.removeEventListener(REFRESH_INTERVAL_EVENT, schedule); };
  }, [dispatch, session]);

  const userMenu: MenuProps["items"] = [
    { key: "settings", label: t("client.app.accountSettings"), icon: <Settings size={16} />, onClick: () => dispatch(pageChanged("settings")) },
    ...(profile?.role === "admin" ? [{ key: "admin", label: t("client.app.adminConsole"), icon: <ShieldCheck size={16} />, onClick: () => window.location.assign(`${session?.baseUrl ?? window.location.origin}/admin`) }] : []),
    { type: "divider" as const },
    { key: "logout", label: t("client.app.signOut"), danger: true, icon: <LogOut size={16} />, onClick: () => void dispatch(signOut()) },
  ];

  const pageDescriptions: Record<Exclude<AppPage, 'chat' | 'downloads' | 'lounge' | 'token-summary' | 'ssh'>, string> = {
    accounts: t("client.app.welcomeBackYourAccountsAtAGlance"),
    discover: t('client.discovery.title'),
    devices: t("client.app.viewAndControlYourDesktopDevices"), totp: t("client.app.manageAndSyncYour2faCodes"), settings: t("client.app.managePreferencesAndAccountSecurity"),
  };
  const downloadScope = session ? downloadOwner(session) : undefined;
  const discoveryPage = <DiscoveryPage owner={downloadScope} loungeUnread={lounge.state.unread}
    onOpen={destination => dispatch(pageChanged(destination))} />;
  const otherPages = {
    lounge: <LoungePage controller={lounge.controller} mobile={!desktopLayout}
      onBack={() => dispatch(pageChanged('discover'))} />,
    discover: discoveryPage, 'token-summary': discoveryPage, ssh: null,
    downloads: session && <DownloadManagerPage owner={downloadOwner(session)}
      onBack={() => dispatch(pageChanged('discover'))} />,
    accounts: <AccountsPage />, devices: <DevicesPage />,
    totp: <TotpPage manager={totpManager} onBack={() => dispatch(pageChanged('discover'))} />,
    settings: <SettingsPage totpManager={totpManager} loungeController={lounge.controller} />,
  };
  const pageTitle = page === 'devices' ? t('client.app.devices')
    : page === 'totp' ? t('client.discovery.twoFactor') : navItems.find(item => item.key === page)?.label;
  const shellClass = ['app-shell', (page === 'chat' || page === 'ssh') && 'chat-active',
    page === 'lounge' && 'lounge-active',
    (page === 'discover' || page === 'token-summary') && 'discovery-active',
    !menuVisible && 'main-menu-collapsed'].filter(Boolean).join(' ');
  const MenuToggleIcon = menuVisible ? PanelLeftClose : PanelLeftOpen;
  return <div className={shellClass}>
    <aside className="desktop-sidebar">
      <div className="desktop-sidebar-heading">
        <div className="brand-lockup"><BrandMark />
          <b>Remote AI</b></div>
        <button type="button" className="main-menu-toggle" aria-label={menuVisible ? t("client.app.collapseMainMenu") : t("client.app.expandMainMenu")}
          aria-expanded={menuVisible} onClick={() => setMenuVisible(value => !value)}>
          <MenuToggleIcon size={20} /></button>
      </div>
      <nav>{navItems.map((item) => <Tooltip key={item.key} placement="right"
        title={menuVisible ? undefined : item.label}>
        <button type="button" aria-label={item.label} aria-current={activeNavigationPage === item.key ? 'page' : undefined}
          className={`sidebar-nav-${item.key}${activeNavigationPage === item.key ? ' active' : ''}`}
          onClick={() => dispatch(pageChanged(item.key))}>
          {item.key === 'discover'
            ? <DownloadCountIcon owners={[downloadScope]}><item.icon size={19} /></DownloadCountIcon>
            : <item.icon size={19} />}<span>{item.label}</span>
        </button>
      </Tooltip>)}
        <Tooltip placement="right" title={menuVisible ? undefined : t('client.lounge.title')}>
          <button type="button" aria-label={t('client.lounge.title')}
            aria-current={page === 'lounge' ? 'page' : undefined}
            className={page === 'lounge' ? 'active' : ''} onClick={() => dispatch(pageChanged('lounge'))}>
            <LoungeIcon unread={lounge.state.unread} /><span>{t('client.lounge.title')}</span>
          </button>
        </Tooltip>
        <Tooltip placement="right" title={menuVisible ? undefined : t('client.downloads.downloads')}>
          <button type="button" aria-label={t('client.downloads.downloads')}
            aria-current={page === 'downloads' ? 'page' : undefined}
            className={page === 'downloads' ? 'active' : ''} onClick={() => dispatch(pageChanged('downloads'))}>
            <DownloadCountIcon owners={[downloadScope]}><Download size={19} /></DownloadCountIcon>
            <span>{t('client.downloads.downloads')}</span>
          </button>
        </Tooltip>
      </nav>
      <Tooltip placement="right" title={menuVisible ? undefined : t("client.app.accountMenu")}>
        <Dropdown menu={{ items: userMenu }} trigger={["click"]}>
          <button type="button" className="sidebar-profile" aria-label={t("client.app.accountMenu")}>
            <LoungeAvatar user={lounge.state.user ?? { id: '', account: profile?.email || session?.email || '' }} />
            <div><strong>{accountLabel(profile?.email || session?.email || '')}</strong>
              <small>{profileRole(profile)}</small></div>
            <Menu size={17} />
          </button>
        </Dropdown>
      </Tooltip>
    </aside>
    <div className="content-shell">
      {page !== 'chat' && page !== 'downloads' && page !== 'lounge' && page !== 'token-summary' && page !== 'ssh'
        && <header className="desktop-topbar"><div>
        <span>{pageTitle}</span><strong>{pageDescriptions[page]}</strong></div>
        <div>{page === 'totp' && <TotpSyncSwitch enabled={totpManager.cloudSyncEnabled}
          loading={totpManager.syncing} onChange={totpManager.setCloudSyncEnabled}
          copy={{ label: t('client.app.sync2faKeys'), on: t('client.settings.on'), off: t('client.settings.off') }} />}
          <Tooltip title={t("client.app.refreshAllData")}><button className="icon-button" type="button"
          onClick={() => void dispatch(refreshAll())}>
          <RefreshCw size={18} className={refreshing ? "spin" : ""} /></button></Tooltip>
          <span className="topbar-date">{new Intl.DateTimeFormat(getLocale(),
            { month: "long", day: "numeric", weekday: "short" }).format(new Date())}</span></div></header>}
      <main className="main-content">
        <PrimaryPagePager page={page} onChange={changePrimaryPage} pages={{
          chat: session && <ChatPage key={session.baseUrl + session.email} session={session} devices={devices}
            openAccounts={openAccounts}
            active={page === 'chat' || page === 'ssh'} tokenSummary={page === 'token-summary'}
            sshDiscovery={page === 'ssh'} closeSshDiscovery={() => dispatch(pageChanged('discover'))}
            closeTokenSummary={() => dispatch(pageChanged('discover'))} />,
          accounts: otherPages.accounts, discover: discoveryPage, settings: otherPages.settings,
        }}>
        {isDiscoveryPage(page)
          && !['downloads', 'token-summary', 'lounge', 'totp', 'devices', 'ssh'].includes(page)
          && <DiscoveryBackButton onBack={() => dispatch(pageChanged('discover'))} />}
        {page !== 'chat' && page !== 'accounts' && page !== 'discover' && page !== 'settings' && otherPages[page]}
        </PrimaryPagePager>
      </main>
    </div>
    <div className="mobile-tabbar">
      <TabBar activeKey={activeNavigationPage}>
        {navItems.map(item => <TabBar.Item key={item.key} title={item.label}
          icon={item.key === 'discover'
            ? <DiscoveryIcon owner={downloadScope} unread={lounge.state.unread} />
            : <item.icon size={21} />}
          onClick={() => dispatch(pageChanged(item.key))} />)}
      </TabBar><SafeArea position="bottom" />
    </div>
  </div>;
}

export default function App() {
  useLanguage();
  const dispatch = useAppDispatch();
  const { session, initialized } = useAppSelector((state) => state.auth);
  useEffect(() => { void dispatch(bootstrapApp()); }, [dispatch]);
  if (!initialized) return <div className="boot-screen"><BrandMark /><SpinLoading color="primary" />
    <p>{t("client.app.openingRemoteAi")}</p></div>;
  return session ? <AppShell /> : <LoginView />;
}
