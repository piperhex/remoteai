import inlineCopy from '@remoteai/i18n/copy/inline/desktop/components/FloatingUsageBubble/index';
import { uiText } from "../../../../../shared/localization/uiText";
import { translate, type Language } from "../../i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  dragFloatingBubble,
  fetchResetCredits,
  loadAppSettings,
  loadDashboard,
  loadLocalProxyStatus,
  loadProviders,
  queryProviderUsage,
  refreshAccountUsage,
  resizeFloatingUsageWindow,
  showDashboardFromBubble,
  showFloatingBubbleMenu,
  subscribeToBubbleResetDisplayChanges,
  subscribeToBubbleStyleChanges,
  subscribeToBackendEvents,
  subscribeToProviderEvents,
} from "../../api/backend";
import { useFloatingProviderStats } from "../../hooks/useFloatingProviderStats";
import { useLanguage } from "../../hooks/useLanguage";
import { useThemeColor } from "../../hooks/useThemeColor";
import type {
  Account,
  BubbleResetDisplay,
  BubbleStyle,
  LocalProxyStatus,
  Provider,
  UsageSummary,
} from "../../types";
import { remainingTone } from "../../../../../shared/accounts/format";
import { ConcurrentUsageCard } from "./ConcurrentUsageCard";
import { FloatingProviderCard } from "../FloatingProviderCard";
import { useConcurrentUsageStats } from "./useConcurrentUsageStats";
import { accountParticipatesInConcurrentRouting } from "./concurrentUsageSummary";
import styles from "./index.module.less";
import { BubbleResetLabel } from "./BubbleResetLabel";
import { useQuotaDisplay } from '../../hooks/useQuotaDisplay';
import { ClassicBubbleVisual } from "./ClassicBubbleVisual";

function usageColor(remaining: number) {
  const tone = remainingTone(remaining);
  if (tone === "danger") return "#ef6b62";
  if (tone === "warning") return "#e5b84f";
  return "var(--green-highlight)";
}

const ignoreThemeError = () => undefined;
const DRAG_THRESHOLD_PX = 5;
const DOUBLE_CLICK_DELAY_MS = 350;

interface BubblePointerGesture {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  doubleClick: boolean;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

type FloatingUsageMode = "account" | "concurrent" | "provider";

function bubbleActionLabel(language: Language, refreshing: boolean, mode: FloatingUsageMode) {
  if (mode === "concurrent") {
    return translate(language, refreshing ? "bubble.refreshingAccounts" : "bubble.refreshAccounts");
  }
  return translate(language, refreshing ? "bubble.refreshingUsage" : "bubble.refreshUsage");
}

function floatingUsageClassName(mode: FloatingUsageMode, glass: boolean, settling: boolean, refreshing: boolean) {
  if (mode === "concurrent") {
    return ["floating-concurrent-card", refreshing ? "is-refreshing" : ""].filter(Boolean).join(" ");
  }
  let modeClass = "floating-bubble-classic";
  if (mode === "provider") modeClass = "floating-provider-card";
  else if (glass) modeClass = "floating-bubble-glass";
  return ["floating-bubble", modeClass, settling ? "is-water-settling" : "", refreshing ? "is-refreshing" : ""]
    .filter(Boolean)
    .join(" ");
}

export function FloatingUsageBubble() {
  const { language, t } = useLanguage();
  const quotaDisplay = useQuotaDisplay();
  const averagePreference = quotaDisplay.status?.enabled ?? false;
  useThemeColor(ignoreThemeError);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  const [localProxy, setLocalProxy] = useState<LocalProxyStatus | null>(null);
  const [routingStateLoaded, setRoutingStateLoaded] = useState(false);
  const [providerUsage, setProviderUsage] = useState<UsageSummary | null>(null);
  const [resetDisplay, setResetDisplay] = useState<BubbleResetDisplay>("countdown");
  const [bubbleStyle, setBubbleStyle] = useState<BubbleStyle>("classic");
  const [resetCreditsRemaining, setResetCreditsRemaining] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [waterSettling, setWaterSettling] = useState(false);
  const lastPrimaryPointerDownAt = useRef(0);
  const pendingClickRefresh = useRef<number | null>(null);
  const pointerGesture = useRef<BubblePointerGesture | null>(null);
  const refreshingRef = useRef(false);
  const previousRemaining = useRef<number | null>(null);
  const providerUsageRequest = useRef(0);

  const load = useCallback(async () => {
    const [{ accounts: nextAccounts }, providers] = await Promise.all([
      loadDashboard(),
      loadProviders(),
    ]);
    setAccounts(nextAccounts);
    const proxy = await loadLocalProxyStatus().catch(() => null);
    if (proxy) setLocalProxy(proxy);
    const active = providers.find((item) => item.active) ?? null;
    const provider = active?.kind === "openai" ? active : null;
    setActiveProvider(active);
    setRoutingStateLoaded(proxy !== null);
    const request = ++providerUsageRequest.current;
    if (!provider) {
      setProviderUsage(null);
      return;
    }
    setProviderUsage(null);
    try {
      const usage = await queryProviderUsage(provider.id);
      if (providerUsageRequest.current === request) setProviderUsage(usage);
    } catch {
      // Keep the bubble available when an older upstream does not expose usage sync yet.
    }
  }, []);
  const loadResetDisplay = useCallback(() => {
    void loadAppSettings()
      .then((settings) => {
        setResetDisplay(settings.bubbleResetDisplay);
        setBubbleStyle(settings.bubbleStyle);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
    return subscribeToBackendEvents(load, load);
  }, [load]);

  useEffect(() => subscribeToProviderEvents(() => void load()), [load]);

  useEffect(() => {
    loadResetDisplay();
  }, [loadResetDisplay]);

  useEffect(() => subscribeToBubbleResetDisplayChanges(loadResetDisplay), [loadResetDisplay]);
  useEffect(() => subscribeToBubbleStyleChanges(setBubbleStyle), []);

  const account = useMemo(() => accounts.find(item => item.active && item.accountSource !== 'claudeCode'), [accounts]);
  const averageMode = averagePreference && routingStateLoaded && Boolean(account) && !activeProvider
    && !localProxy?.activeProviderGroup && !localProxy?.concurrentAccountRoutingEnabled;
  const average = averageMode ? quotaDisplay.status?.average : null;
  const activeUpstreamProvider = activeProvider?.kind === "openai" ? activeProvider : null;
  const activeCustomProvider = activeProvider?.kind === "custom" ? activeProvider : null;
  const concurrentRoutingActive = Boolean(localProxy?.concurrentAccountRoutingEnabled);
  let floatingMode: FloatingUsageMode = "account";
  if (concurrentRoutingActive) floatingMode = "concurrent";
  else if (activeCustomProvider) floatingMode = "provider";
  const concurrentProviders = useMemo(
    () => activeProvider ? [activeProvider] : [],
    [activeProvider],
  );
  const providerStats = useFloatingProviderStats(activeCustomProvider);
  const concurrentAccountGroup = localProxy?.concurrentAccountGroup ?? null;
  const concurrentStats = useConcurrentUsageStats(
    concurrentRoutingActive,
    accounts,
    concurrentProviders,
    concurrentAccountGroup,
  );
  const refreshProviderStats = providerStats.refresh;
  const accountId = averageMode ? null : account?.id ?? null;

  useEffect(() => {
    const windowMode = concurrentRoutingActive
      ? "concurrentCard"
      : activeCustomProvider ? "providerCard" : bubbleStyle;
    void resizeFloatingUsageWindow(windowMode).catch(() => undefined);
  }, [activeCustomProvider?.id, bubbleStyle, concurrentRoutingActive]);
  useEffect(() => {
    let active = true;
    if (!accountId) {
      setResetCreditsRemaining(null);
      return () => { active = false; };
    }
    setResetCreditsRemaining(null);
    void fetchResetCredits(accountId)
      .then((summary) => {
        if (active) setResetCreditsRemaining(summary.credits.length);
      })
      .catch(() => {
        if (active) setResetCreditsRemaining(null);
    });
    return () => { active = false; };
  }, [accountId]);
  const usage = averageMode ? average?.usage : providerUsage ?? account?.usage;
  const primary = usage?.primary;
  const secondary = usage?.secondary;
  const remaining = primary ? clampPercent(primary.remainingPercent) : null;
  const weeklyRemaining = secondary ? clampPercent(secondary.remainingPercent) : null;
  const secondaryUsed = weeklyRemaining === null ? null : 100 - weeklyRemaining;
  const status = remaining === null
    ? "--"
    : remainingTone(remaining) === "danger"
      ? ((language !== "zh" && language !== "en" ? uiText("client.usage.lowQuota", {}, language) : language === "zh" ? inlineCopy["text_f9618187"] : inlineCopy["Low_quota_88561be9"]))
      : remainingTone(remaining) === "warning"
        ? ((language !== "zh" && language !== "en" ? uiText("client.usage.watchQuota", {}, language) : language === "zh" ? inlineCopy["text_35d6abd0"] : inlineCopy["Quota_warning_78ee451a"]))
        : ((language !== "zh" && language !== "en" ? uiText("client.usage.quotaAvailable", {}, language) : language === "zh" ? inlineCopy["text_f6e0fb5e"] : inlineCopy["Quota_healthy_be7d3cf1"]));
  const bubbleLabel = averageMode ? t('settings.quotaDisplay.summary', {
    primary: average?.primaryAccounts ?? 0, secondary: average?.secondaryAccounts ?? 0,
    total: average?.totalAccounts ?? accounts.length,
  }) + (average?.stale || quotaDisplay.error ? ` · ${t('settings.quotaDisplay.stale')}` : '')
    : bubbleActionLabel(language, refreshing, floatingMode);
  const resetLabel = averageMode ? <small className="floating-bubble-reset">
    {t('settings.quotaDisplay.short')}
  </small> : <BubbleResetLabel timestamp={primary?.resetsAt} language={language} display={resetDisplay} />;
  const ringStyle = {
    "--bubble-progress": `${remaining ?? 0}%`,
    "--bubble-color": remaining === null ? "#7b8780" : usageColor(remaining),
  } as CSSProperties;

  useEffect(() => {
    if (remaining === null) {
      previousRemaining.current = null;
      setWaterSettling(false);
      return;
    }
    const previous = previousRemaining.current;
    previousRemaining.current = remaining;
    if (previous !== null && remaining < previous) {
      setWaterSettling(true);
      const timer = window.setTimeout(() => setWaterSettling(false), 1100);
      return () => window.clearTimeout(timer);
    }
  }, [remaining]);

  const refreshCurrentUsage = useCallback(async () => {
    if ((!averageMode && !account && !activeProvider && !concurrentRoutingActive) || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      if (averageMode) {
        await Promise.allSettled(accounts.map((item) => refreshAccountUsage(item.id)));
        await Promise.all([load(), quotaDisplay.refresh()]);
      } else if (concurrentRoutingActive) {
        const enabledAccounts = accounts.filter((item) => (
          accountParticipatesInConcurrentRouting(item, concurrentAccountGroup)
        ));
        await Promise.allSettled(enabledAccounts.map((item) => refreshAccountUsage(item.id)));
        await Promise.all([load(), concurrentStats.refresh()]);
      } else if (activeCustomProvider) {
        await refreshProviderStats();
      } else if (activeUpstreamProvider) {
        const usage = await queryProviderUsage(activeUpstreamProvider.id);
        setProviderUsage(usage);
      } else if (account) {
        await refreshAccountUsage(account.id);
        await load();
      }
    } catch {
      await load().catch(() => undefined);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [
    account,
    averageMode,
    quotaDisplay.refresh,
    accounts,
    activeCustomProvider,
    activeProvider,
    activeUpstreamProvider,
    concurrentRoutingActive,
    concurrentAccountGroup,
    concurrentStats.refresh,
    load,
    refreshProviderStats,
  ]);

  useEffect(() => () => {
    if (pendingClickRefresh.current !== null) {
      window.clearTimeout(pendingClickRefresh.current);
    }
  }, []);

  const startPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const now = Date.now();
    const doubleClick = now - lastPrimaryPointerDownAt.current < DOUBLE_CLICK_DELAY_MS;
    if (doubleClick) {
      lastPrimaryPointerDownAt.current = 0;
      if (pendingClickRefresh.current !== null) {
        window.clearTimeout(pendingClickRefresh.current);
        pendingClickRefresh.current = null;
      }
    } else {
      lastPrimaryPointerDownAt.current = now;
    }
    pointerGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      doubleClick,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continuePointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = pointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.dragging || !(event.buttons & 1)) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < DRAG_THRESHOLD_PX) return;
    gesture.dragging = true;
    lastPrimaryPointerDownAt.current = 0;
    event.preventDefault();
    void dragFloatingBubble();
  };

  const finishPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = pointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    pointerGesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (gesture.dragging) return;
    if (gesture.doubleClick) {
      void showDashboardFromBubble();
      return;
    }
    pendingClickRefresh.current = window.setTimeout(() => {
      pendingClickRefresh.current = null;
      void refreshCurrentUsage();
    }, DOUBLE_CLICK_DELAY_MS);
  };

  const cancelPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerGesture.current?.pointerId === event.pointerId) pointerGesture.current = null;
  };

  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void showFloatingBubbleMenu({ x: event.clientX, y: event.clientY });
  };

  return (
    <div className={`${styles.styleScope} floating-usage-window`} onContextMenu={openContextMenu}>
      <button
        type="button"
        className={floatingUsageClassName(floatingMode, bubbleStyle === "glass", waterSettling, refreshing)}
        style={concurrentRoutingActive ? undefined : ringStyle}
        aria-label={bubbleLabel}
        title={bubbleLabel}
        aria-busy={refreshing}
        onPointerDown={startPointerGesture}
        onPointerMove={continuePointerGesture}
        onPointerUp={finishPointerGesture}
        onPointerCancel={cancelPointerGesture}
        onClick={(event) => { if (event.detail === 0) void refreshCurrentUsage(); }}>
        {concurrentRoutingActive ? <ConcurrentUsageCard
          display={concurrentStats.display}
          language={language}
          summary={concurrentStats.summary}
        /> : activeCustomProvider ? <FloatingProviderCard
          balance={providerStats.balance}
          balanceError={providerStats.balanceError}
          language={language}
          loading={providerStats.loading}
          provider={activeCustomProvider}
          t={t}
          tokenUsage={providerStats.tokenUsage}
        /> : <>
          {bubbleStyle === "classic" && <ClassicBubbleVisual
            remaining={remaining}
            weeklyRemaining={weeklyRemaining}
            weekLabel={(language !== "zh" && language !== "en" ? uiText("client.chat.weeks", {}, language) : language === "zh" ? inlineCopy["text_5c553ec3"] : inlineCopy["W_fcb5f40d"])}
            resetLabel={resetLabel}
          />}
          {bubbleStyle === "glass" && <><span className="floating-glass-ring" aria-hidden="true">
            <span>{remaining === null ? "--" : `${remaining}%`}</span>
            <small>{(language !== "zh" && language !== "en" ? uiText("client.usage.primaryUsageRemaining", {}, language) : language === "zh" ? inlineCopy["text_f5148b69"] : inlineCopy["Primary_left_173af980"])}</small>
          </span>
          <span className="floating-glass-brand">{averageMode ? t('settings.quotaDisplay.short') : 'Codex'}</span>
          <span className="floating-glass-details">
            <span>
              <b>{(language !== "zh" && language !== "en" ? uiText("client.usage.timeUntilReset", {}, language) : language === "zh" ? inlineCopy["text_aeb81803"] : inlineCopy["Until_reset_49a041fd"])}</b>
              {averageMode ? <strong>--</strong> : <BubbleResetLabel timestamp={primary?.resetsAt}
                language={language} display={resetDisplay} className="floating-glass-reset" compact />}
            </span>
            <span>
              <b>{(language !== "zh" && language !== "en" ? uiText("client.usage.resetsRemaining", {}, language) : language === "zh" ? inlineCopy["text_e87a1d3b"] : inlineCopy["Resets_left_e1a17497"])}</b>
              <strong>
                {resetCreditsRemaining === null ? "--" : `${resetCreditsRemaining}${(language !== "zh" && language !== "en" ? uiText("client.usage.times", {}, language) : language === "zh" ? inlineCopy["text_f81526ef"] : "")}`}
              </strong>
            </span>
            <span>
              <b>{(language !== "zh" && language !== "en" ? uiText("client.usage.secondaryUsageUsed", {}, language) : language === "zh" ? inlineCopy["text_75d589da"] : inlineCopy["Secondary_used_d8146230"])}</b>
              <strong>{secondaryUsed === null ? "--" : `${secondaryUsed}%`}</strong>
            </span>
            <span>
              <b>{(language !== "zh" && language !== "en" ? uiText("client.usage.quotaStatus", {}, language) : language === "zh" ? inlineCopy["text_3002bcb1"] : inlineCopy["Quota_status_c1fec4cc"])}</b>
              <strong className={`floating-glass-status ${remaining === null ? "" : remainingTone(remaining)}`}>
                {status}
              </strong>
            </span>
          </span></>}
        </>}
      </button>
    </div>
  );
}
