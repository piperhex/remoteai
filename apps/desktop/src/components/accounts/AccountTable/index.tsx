import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AutoComplete,
  Button,
  Checkbox,
  Dropdown,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CalendarClock,
  Check,
  CircleHelp,
  Columns3,
  Copy,
  Gauge,
  GripVertical,
  LogIn,
  LogOut,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import {
  loadAccountTokenUsage,
  loadProxySessions,
  subscribeToTokenUsageChanges,
} from "../../../api/backend";
import type { Language, Translate } from "../../../i18n";
import type { AccountDisplayMode } from "../../../hooks/useAccountDisplayMode";
import {
  DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW_K,
  GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS_K,
  type ModelContextWindowError,
  useGpt56SolContextWindow,
} from "../../../hooks/useGpt56SolContextWindow";
import type {
  Account,
  AccountDetailsDraft,
  AccountTokenUsageTotals,
  Provider,
  ResetCreditsLoadState,
} from "../../../types";
import { accountExpirationDate } from "../../../utils/expiration";
import { maskAccountEmail } from "../../../utils/accountPrivacy";
import { shouldShowUsageError } from "../../../utils/usageErrors";
import {
  formatEstimatedCost,
  invalidateCustomTokenCostRulesCache,
  TOKEN_COST_CUSTOM_RULES_EVENT,
} from "../../../utils/tokenCost";
import { TOKEN_COST_REFERENCE_MODEL_EVENT } from "../../../utils/tokenCostPresets";
import {
  FAST_MODE_COST_MULTIPLIER_EVENT,
  FAST_MODE_COST_MULTIPLIER_STORAGE_KEY,
} from "../../../utils/tokenCostFastMode";
import { LONG_CONTEXT_COST_EVENT, LONG_CONTEXT_COST_STORAGE_KEY } from "../../../utils/tokenCostLongContext";
import { TokenCostColumnTitle, useTokenCostDisplaySettings } from "../../TokenCostUnitSettings";
import { AccountNoteModal } from "../../modals/AccountNoteModal";
import { AccountExpandedPanel } from "../AccountExpandedPanel";
import { AccountAvatar } from "../AccountAvatar";
import { AccountCardFooter } from "../AccountCardFooter";
import { accountCardLabels } from "../accountCardLabels";
import { AccountCredits, AccountCreditsTitle } from "../AccountCredits";
import { AccountCardAutoSwitchSettings } from "../AccountCardAutoSwitchSettings";
import { AccountGroupCell, ConcurrentRoutingControl } from "../AccountGroupControls";
import { AccountUseActionIcon } from "../AccountUseActionIcon";
import { OfficialContextSettings } from "../OfficialContextSettings";
import { UsageMeter, UsageRefreshAge } from "../UsageMeter";
import { canReceiveConcurrentConversation } from "../concurrentAccountEligibility";
import { createAccountTokenUsageLookup } from "../accountCardUsage";
import { useOfficialUsage } from "../../../hooks/useOfficialUsage";
import { officialUsageLabels } from "../../../../../../shared/officialUsageLabels";
import { AvailableQuota } from "../../TokenUsageDashboard/OfficialAccountUsage";
import { getSwitchableAccounts } from "../accountSelectors";
import { confirmOfficialAuthAccountChange } from "../confirmOfficialAuthAccountChange";
import styles from "./index.module.less";
import {
  AccountNoteEditButton,
  AccountPrivacyToggle,
  AccountResetCreditCount,
  AutoSwitchPriorityInput,
  AutoSwitchThresholdInput,
  canEditAccountMetadata,
  CompactDailyTokenChart,
  CopyableAccountEmail,
  GlobalAutoSwitchThresholdControl,
  needsAccountAttention,
  resetCreditsCount,
  ResetCreditsModal,
} from "../AccountTableParts";

interface AccountTableProps {
  active: boolean;
  accounts: Account[];
  accountGroups: string[];
  providers: Provider[];
  busyAccountId: string | null;
  onSwitch: (id: string) => void;
  onDeactivate: (id: string) => void;
  onCopyAuthJson: (id: string) => void;
  onRefresh: (id: string) => void;
  onRefreshAllUsage: () => void;
  refreshingAllUsage: boolean;
  onDelete: (id: string) => void;
  onConsumeQuotaMany: (ids: string[]) => Promise<string[]>;
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  onEnableMany: (ids: string[]) => Promise<string[]>;
  onDisableMany: (ids: string[]) => Promise<string[]>;
  onAccountGroupChange: (id: string, group: string) => Promise<boolean>;
  onAutoSwitchEnabledChange: (id: string, enabled: boolean) => void;
  autoSwitchBusyAccountId: string | null;
  onAutoSwitchPriorityChange: (id: string, priority: number) => Promise<boolean>;
  autoSwitchPriorityBusyAccountId: string | null;
  onAutoSwitchThresholdChange: (id: string, threshold: number) => Promise<boolean>;
  autoSwitchThresholdBusyAccountId: string | null;
  autoSwitchOnQuotaExhaustion: boolean;
  customAutoSwitchPriorityEnabled: boolean;
  customAutoSwitchThresholdEnabled: boolean;
  globalAutoSwitchThreshold: number;
  onGlobalAutoSwitchThresholdChange: (threshold: number) => Promise<boolean>;
  onSaveNote: (id: string, details: AccountDetailsDraft) => Promise<boolean>;
  onLoadAccountDetails: (id: string) => Promise<Account | null>;
  resetCredits: Record<string, ResetCreditsLoadState>;
  onLoadResetCredits: (id: string, force?: boolean) => void;
  onUseResetCredit: (id: string) => void;
  resetCreditBusyAccountId: string | null;
  hotSwitchEnabled: boolean;
  fastModeEnabled: boolean;
  proxySpeedControl?: ReactNode;
  concurrentAccountRoutingEnabled: boolean;
  concurrentAccountGroup: string | null;
  concurrentAccountRoutingBusy: boolean;
  onConcurrentAccountRoutingChange: (enabled: boolean, group: string | null) => void;
  openaiAuthAccountId: string | null;
  openaiAuthBusy: boolean;
  onOpenaiAuthAccountChange: (accountId: string | null) => void;
  privacyMode: boolean;
  privacyModeLoading: boolean;
  onPrivacyModeChange: (enabled: boolean) => void;
  hideAccountNotes: boolean;
  showUsageNetworkErrors: boolean;
  displayMode: AccountDisplayMode;
  tokenUsageRefreshSeconds: number;
  language: Language;
  t: Translate;
}

const USAGE_SORT_STORAGE_KEY = "codex-switch:account-table-usage-sort";
const HIDDEN_COLUMNS_STORAGE_KEY = "codex-switch:account-table-hidden-columns";
const GROUP_COLUMN_PREFERENCE_STORAGE_KEY = "codex-switch:account-table-group-column-preference";
const GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS = GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS_K.map((value) => ({
  label: `${value}K`,
  value: String(value),
}));

function modelContextWindowTooltipKey(error: ModelContextWindowError) {
  if (error === "invalid") return "table.modelContextWindowInvalid" as const;
  if (error === "save") return "table.modelContextWindowSaveError" as const;
  return "table.modelContextWindowTooltip" as const;
}

type UsageSortColumn = "fiveHours" | "oneWeek";
type UsageSortOrder = "ascend" | "descend";
const ACCOUNT_TABLE_COLUMN_KEYS = [
  "account",
  "group",
  "fiveHours",
  "oneWeek",
  "credits",
  "tokenTotals",
  "estimatedCost",
  "availableQuota",
  "autoSwitchPriority",
  "autoSwitchThreshold",
  "actions",
] as const;
type AccountTableColumnKey = typeof ACCOUNT_TABLE_COLUMN_KEYS[number];
type ReorderableAccountTableColumnKey = Exclude<AccountTableColumnKey, "account" | "actions">;
const REORDERABLE_ACCOUNT_TABLE_COLUMN_KEYS: ReorderableAccountTableColumnKey[] = [
  "group",
  "fiveHours",
  "oneWeek",
  "credits",
  "tokenTotals",
  "estimatedCost",
  "availableQuota",
  "autoSwitchPriority",
  "autoSwitchThreshold",
];
const COLUMN_ORDER_STORAGE_KEY = "codex-switch:account-table-column-order";

interface UsageSortPreference {
  column: UsageSortColumn;
  order: UsageSortOrder;
}

interface AccountContextMenu {
  accountId: string;
  x: number;
  y: number;
}

const ACCOUNT_CONTEXT_MENU_WIDTH = 220;
const ACCOUNT_CONTEXT_MENU_HEIGHT = {
  hotSwitch: 352,
  directSwitch: 276,
} as const;

function contextMenuPosition(event: { clientX: number; clientY: number }, menuHeight: number) {
  return {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - ACCOUNT_CONTEXT_MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
  };
}

function isUsageSortColumn(value: unknown): value is UsageSortColumn {
  return value === "fiveHours" || value === "oneWeek";
}

function isUsageSortOrder(value: unknown): value is UsageSortOrder {
  return value === "ascend" || value === "descend";
}

function loadUsageSortPreference(): UsageSortPreference | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(USAGE_SORT_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const preference = parsed as Partial<UsageSortPreference>;
    if (!isUsageSortColumn(preference.column) || !isUsageSortOrder(preference.order)) return null;
    return { column: preference.column, order: preference.order };
  } catch {
    return null;
  }
}

function persistUsageSortPreference(preference: UsageSortPreference | null) {
  if (!preference) {
    window.localStorage.removeItem(USAGE_SORT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(USAGE_SORT_STORAGE_KEY, JSON.stringify(preference));
}

function isAccountTableColumnKey(value: unknown): value is AccountTableColumnKey {
  return typeof value === "string"
    && (ACCOUNT_TABLE_COLUMN_KEYS as readonly string[]).includes(value);
}

function loadHiddenColumns(): AccountTableColumnKey[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY) ?? "[]");
    const stored = Array.isArray(parsed) ? parsed.filter(isAccountTableColumnKey) : [];
    const groupPreferenceSaved = window.localStorage.getItem(GROUP_COLUMN_PREFERENCE_STORAGE_KEY) === "true";
    return [...new Set(groupPreferenceSaved ? stored : [...stored, "group" as const])];
  } catch {
    return ["group"];
  }
}

function persistHiddenColumns(columns: AccountTableColumnKey[]) {
  window.localStorage.setItem(HIDDEN_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
}

function isReorderableAccountTableColumnKey(value: unknown): value is ReorderableAccountTableColumnKey {
  return typeof value === "string"
    && REORDERABLE_ACCOUNT_TABLE_COLUMN_KEYS.includes(value as ReorderableAccountTableColumnKey);
}

function loadColumnOrder(): ReorderableAccountTableColumnKey[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(COLUMN_ORDER_STORAGE_KEY) ?? "[]");
    const stored = Array.isArray(parsed)
      ? [...new Set(parsed.filter(isReorderableAccountTableColumnKey))]
      : [];
    return [
      ...stored,
      ...REORDERABLE_ACCOUNT_TABLE_COLUMN_KEYS.filter((key) => !stored.includes(key)),
    ];
  } catch {
    return [...REORDERABLE_ACCOUNT_TABLE_COLUMN_KEYS];
  }
}

function persistColumnOrder(columns: ReorderableAccountTableColumnKey[]) {
  try {
    window.localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Keep the in-memory order when local storage is unavailable.
  }
}

function usageRemainingSortValue(window: Account["usage"]["primary"]) {
  return typeof window?.remainingPercent === "number" ? window.remainingPercent : Number.NEGATIVE_INFINITY;
}

function compareUsageRemaining(
  left: Account,
  right: Account,
  usageWindow: "primary" | "secondary",
) {
  return usageRemainingSortValue(left.usage[usageWindow]) - usageRemainingSortValue(right.usage[usageWindow]);
}

function isAccountDisabled(account: Account, hotSwitchEnabled: boolean) {
  return hotSwitchEnabled && !account.autoSwitchEnabled;
}

function isAccountHighlighted(
  account: Account,
  concurrentRoutingActive: boolean,
  accountGroup: string | null,
  minimumPrimaryRemaining: number | null,
) {
  return concurrentRoutingActive
    ? canReceiveConcurrentConversation(account, { accountGroup, minimumPrimaryRemaining })
    : account.active;
}

function compareKeepingAttentionLast(
  left: Account,
  right: Account,
  hotSwitchEnabled: boolean,
  showUsageNetworkErrors: boolean,
  sortOrder: UsageSortOrder | null | undefined,
  compare: (left: Account, right: Account) => number,
) {
  const attentionOrder = Number(needsAccountAttention(left, hotSwitchEnabled, showUsageNetworkErrors))
    - Number(needsAccountAttention(right, hotSwitchEnabled, showUsageNetworkErrors));
  if (attentionOrder !== 0) return sortOrder === "descend" ? -attentionOrder : attentionOrder;
  return compare(left, right);
}

export function AccountTable({
  active,
  accounts,
  accountGroups,
  providers,
  busyAccountId,
  onSwitch,
  onDeactivate,
  onCopyAuthJson,
  onRefresh,
  onRefreshAllUsage,
  refreshingAllUsage,
  onDelete,
  onConsumeQuotaMany,
  onDeleteMany,
  onEnableMany,
  onDisableMany,
  onAccountGroupChange,
  onAutoSwitchEnabledChange,
  autoSwitchBusyAccountId,
  onAutoSwitchPriorityChange,
  autoSwitchPriorityBusyAccountId,
  onAutoSwitchThresholdChange,
  autoSwitchThresholdBusyAccountId,
  autoSwitchOnQuotaExhaustion,
  customAutoSwitchPriorityEnabled,
  customAutoSwitchThresholdEnabled,
  globalAutoSwitchThreshold,
  onGlobalAutoSwitchThresholdChange,
  onSaveNote,
  onLoadAccountDetails,
  resetCredits,
  onLoadResetCredits,
  onUseResetCredit,
  resetCreditBusyAccountId,
  hotSwitchEnabled,
  fastModeEnabled,
  proxySpeedControl,
  concurrentAccountRoutingEnabled,
  concurrentAccountGroup,
  concurrentAccountRoutingBusy,
  onConcurrentAccountRoutingChange,
  openaiAuthAccountId,
  openaiAuthBusy,
  onOpenaiAuthAccountChange,
  privacyMode,
  privacyModeLoading,
  onPrivacyModeChange,
  hideAccountNotes,
  showUsageNetworkErrors,
  displayMode,
  tokenUsageRefreshSeconds,
  language,
  t,
}: AccountTableProps) {
  const concurrentRoutingActive = hotSwitchEnabled && concurrentAccountRoutingEnabled;
  const groups = useMemo(() => [...new Set([
    ...accountGroups,
    ...accounts.map((account) => account.group),
  ].filter(Boolean))], [accountGroups, accounts]);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [loadingAccountDetailsId, setLoadingAccountDetailsId] = useState<string | null>(null);
  const [resetCreditsAccount, setResetCreditsAccount] = useState<Account | null>(null);
  const [contextMenu, setContextMenu] = useState<AccountContextMenu | null>(null);
  const [tableActionMenuAccountId, setTableActionMenuAccountId] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [bulkConsumeQuotaConfirmOpen, setBulkConsumeQuotaConfirmOpen] = useState(false);
  const [bulkConsumeQuotaBusy, setBulkConsumeQuotaBusy] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [bulkEnableBusy, setBulkEnableBusy] = useState(false);
  const [bulkDisableBusy, setBulkDisableBusy] = useState(false);
  const [openaiAuthPendingAccountId, setOpenaiAuthPendingAccountId] = useState<string | null>(null);
  const [usageSort, setUsageSort] = useState<UsageSortPreference | null>(loadUsageSortPreference);
  const [hiddenColumns, setHiddenColumns] = useState<AccountTableColumnKey[]>(loadHiddenColumns);
  const [columnOrder, setColumnOrder] = useState<ReorderableAccountTableColumnKey[]>(loadColumnOrder);
  const draggedColumnRef = useRef<ReorderableAccountTableColumnKey | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<ReorderableAccountTableColumnKey | null>(null);
  const [dragTargetColumn, setDragTargetColumn] = useState<ReorderableAccountTableColumnKey | null>(null);
  const modelContextWindow = useGpt56SolContextWindow();
  const [tableScrollY, setTableScrollY] = useState(0);
  const [accountTokenUsage, setAccountTokenUsage] = useState<AccountTokenUsageTotals[]>([]);
  const officialUsage = useOfficialUsage({ active, refreshSeconds: tokenUsageRefreshSeconds });
  const officialUsageById = useMemo(() => new Map(officialUsage.accounts.map((account) => [account.accountId, account])),
    [officialUsage.accounts]);
  const accountUsageRefreshing = useRef(false);
  const refreshCurrentAccountUsage = useRef<(() => void) | null>(null);
  const [accountConversationCounts, setAccountConversationCounts] = useState<Record<string, number>>({});
  const tokenCostDisplay = useTokenCostDisplaySettings();
  const [cardTopbarHost, setCardTopbarHost] = useState<HTMLElement | null>(null);
  const openAccountDetails = (account: Account) => {
    setEditingAccount(account);
    setLoadingAccountDetailsId(account.id);
    void onLoadAccountDetails(account.id)
      .then((latest) => {
        setEditingAccount((current) => current?.id === account.id ? latest : current);
      })
      .finally(() => {
        setLoadingAccountDetailsId((current) => current === account.id ? null : current);
      });
  };
  useEffect(() => {
    const showCardControls = active && displayMode === "cards";
    setCardTopbarHost(showCardControls ? document.getElementById("account-card-topbar-controls") : null);
  }, [active, displayMode]);
  useEffect(() => {
    if (!active || displayMode !== "table") {
      setTableScrollY(0);
      return undefined;
    }
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return undefined;

    const updateScrollHeight = () => {
      const headerHeight = tableWrap.querySelector(".ant-table-thead")?.getBoundingClientRect().height ?? 0;
      const toolbarHeight = tableWrap.querySelector(".account-table-toolbar")?.getBoundingClientRect().height ?? 0;
      setTableScrollY(Math.max(1, Math.floor(tableWrap.clientHeight - headerHeight - toolbarHeight)));
    };
    const observer = new ResizeObserver(updateScrollHeight);
    observer.observe(tableWrap);
    updateScrollHeight();
    return () => observer.disconnect();
  }, [active, displayMode]);
  useEffect(() => {
    const closeContextMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".ant-popconfirm")) return;
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    document.addEventListener("pointerdown", closeContextMenu);
    return () => document.removeEventListener("pointerdown", closeContextMenu);
  }, []);
  useEffect(() => {
    // Persisted usage remains available while proxy status is loading or the proxy is stopped.
    if (!active) return undefined;
    let mounted = true;
    const refresh = async () => {
      if (!mounted || accountUsageRefreshing.current) return;
      accountUsageRefreshing.current = true;
      try {
        const today = new Date();
        const startTs = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        ).getTime() / 1_000;
        const totals = await loadAccountTokenUsage(startTs, providers);
        if (mounted) setAccountTokenUsage(totals);
      } catch {
        // Keep the last successful totals; quota rendering must not fail with token statistics.
      } finally {
        accountUsageRefreshing.current = false;
        // If pricing or visibility changed mid-request, refresh with the latest inputs after it settles.
        if (!mounted) refreshCurrentAccountUsage.current?.();
      }
    };
    refreshCurrentAccountUsage.current = () => void refresh();
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(1, tokenUsageRefreshSeconds) * 1000);
    const unsubscribe = subscribeToTokenUsageChanges(() => void refresh());
    const refreshStoredMultiplier = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage
        || (event.key !== null && event.key !== FAST_MODE_COST_MULTIPLIER_STORAGE_KEY
          && event.key !== LONG_CONTEXT_COST_STORAGE_KEY)) return;
      invalidateCustomTokenCostRulesCache();
      void refresh();
    };
    window.addEventListener(TOKEN_COST_CUSTOM_RULES_EVENT, refresh);
    window.addEventListener(TOKEN_COST_REFERENCE_MODEL_EVENT, refresh);
    window.addEventListener(FAST_MODE_COST_MULTIPLIER_EVENT, refresh);
    window.addEventListener(LONG_CONTEXT_COST_EVENT, refresh);
    window.addEventListener("storage", refreshStoredMultiplier);
    return () => {
      mounted = false;
      refreshCurrentAccountUsage.current = null;
      window.clearInterval(timer);
      unsubscribe();
      window.removeEventListener(TOKEN_COST_CUSTOM_RULES_EVENT, refresh);
      window.removeEventListener(TOKEN_COST_REFERENCE_MODEL_EVENT, refresh);
      window.removeEventListener(FAST_MODE_COST_MULTIPLIER_EVENT, refresh);
      window.removeEventListener(LONG_CONTEXT_COST_EVENT, refresh);
      window.removeEventListener("storage", refreshStoredMultiplier);
    };
  }, [active, providers, tokenUsageRefreshSeconds]);
  useEffect(() => {
    if (!concurrentRoutingActive) {
      setAccountConversationCounts({});
      return undefined;
    }
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const accountIds = new Set(accounts.map((account) => account.id));
        const counts: Record<string, number> = {};
        (await loadProxySessions()).forEach((session) => {
          const accountId = session.accountId;
          if (session.concurrentRouted && session.activeRequests > 0
            && accountId && accountIds.has(accountId)) {
            counts[accountId] = (counts[accountId] ?? 0) + 1;
          }
        });
        if (active) setAccountConversationCounts(counts);
      } catch {
        // Keep the last successful counts while the proxy session list is unavailable.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accounts, concurrentRoutingActive]);
  useEffect(() => {
    const accountIds = new Set(accounts.map((account) => account.id));
    setSelectedAccountIds((current) => {
      const next = current.filter((id) => accountIds.has(id));
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [accounts]);
  useEffect(() => {
    if (!openaiAuthBusy) setOpenaiAuthPendingAccountId(null);
  }, [openaiAuthBusy]);
  const customPriorityActive = hotSwitchEnabled
    && autoSwitchOnQuotaExhaustion
    && customAutoSwitchPriorityEnabled;
  const customThresholdActive = hotSwitchEnabled
    && autoSwitchOnQuotaExhaustion
    && customAutoSwitchThresholdEnabled;
  const usageForAccount = useMemo(
    () => createAccountTokenUsageLookup(accounts, accountTokenUsage),
    [accounts, accountTokenUsage],
  );
  const orderedAccounts = useMemo(() => [...accounts].sort(
    (left, right) => Number(needsAccountAttention(left, hotSwitchEnabled, showUsageNetworkErrors))
      - Number(needsAccountAttention(right, hotSwitchEnabled, showUsageNetworkErrors)),
  ), [accounts, hotSwitchEnabled, showUsageNetworkErrors]);
  const selectedAccountIdSet = new Set(selectedAccountIds);
  const consumableSelectedAccountIds = accounts
    .filter((account) => selectedAccountIdSet.has(account.id) && account.autoSwitchEnabled)
    .map((account) => account.id);
  const deletableSelectedAccountIds = accounts
    .filter((account) => selectedAccountIdSet.has(account.id) && !account.active)
    .map((account) => account.id);
  const enableableSelectedAccountIds = accounts
    .filter((account) => selectedAccountIdSet.has(account.id) && !account.autoSwitchEnabled)
    .map((account) => account.id);
  const disableableSelectedAccountIds = accounts
    .filter((account) => selectedAccountIdSet.has(account.id) && account.autoSwitchEnabled)
    .map((account) => account.id);
  const activeAccount = accounts.find((account) => account.active) ?? null;
  const requestOpenaiAuthAccountChange = (accountId: string | null) => {
    if (openaiAuthBusy || accountId === openaiAuthAccountId) return;
    confirmOfficialAuthAccountChange({
      accountId,
      currentAccountId: openaiAuthAccountId,
      t,
      onConfirm: (confirmedAccountId) => {
        setOpenaiAuthPendingAccountId(confirmedAccountId ?? openaiAuthAccountId);
        onOpenaiAuthAccountChange(confirmedAccountId);
      },
    });
  };
  const accountSummaryLabel = (account: Account | null) => {
    if (!account) return "-";
    return privacyMode ? maskAccountEmail(account.email) : account.email;
  };
  const switchableAccounts = useMemo(
    () => getSwitchableAccounts(accounts, hotSwitchEnabled),
    [accounts, hotSwitchEnabled],
  );
  const switchableAccountIds = new Set(switchableAccounts.map((account) => account.id));
  const accountSelectAccounts = activeAccount && !switchableAccountIds.has(activeAccount.id)
    ? [...switchableAccounts, activeAccount]
    : switchableAccounts;
  const accountSelectOptions = accountSelectAccounts.map((account) => ({
    label: accountSummaryLabel(account),
    value: account.id,
    disabled: !switchableAccountIds.has(account.id),
  }));
  const handleTableChange: NonNullable<TableProps<Account>["onChange"]> = (_, __, sorter) => {
    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    const nextSort = isUsageSortColumn(activeSorter.columnKey) && isUsageSortOrder(activeSorter.order)
      ? { column: activeSorter.columnKey, order: activeSorter.order }
      : null;

    setUsageSort(nextSort);
    persistUsageSortPreference(nextSort);
  };

  const columns: ColumnsType<Account> = [
    Table.EXPAND_COLUMN as ColumnsType<Account>[number],
    {
      title: (
        <span className="account-column-title">
          <span>{t("table.account")}</span>
          <AccountPrivacyToggle enabled={privacyMode} loading={privacyModeLoading}
            onChange={onPrivacyModeChange} t={t} />
        </span>
      ), key: "account", dataIndex: "email", width: 280, fixed: "left",
      sorter: (left, right, sortOrder) => compareKeepingAttentionLast(
        left,
        right,
        hotSwitchEnabled,
        showUsageNetworkErrors,
        sortOrder,
        (first, second) => first.email.localeCompare(second.email),
      ),
      filters: [
        { text: t("table.filterNormal"), value: "normal" },
        { text: t("table.filterError"), value: "error" },
      ],
      onFilter: (value, account) => value === "error"
        ? needsAccountAttention(account, hotSwitchEnabled, showUsageNetworkErrors)
        : !needsAccountAttention(account, hotSwitchEnabled, showUsageNetworkErrors),
      render: (_, account) => (
        <div className="account-cell">
          <div className="table-avatar-wrap">
            <AccountAvatar email={account.email} disabled={isAccountDisabled(account, hotSwitchEnabled)}
              officialAuthActive={openaiAuthAccountId === account.id} busy={openaiAuthBusy} variant="table"
              onClearOfficialAuth={() => requestOpenaiAuthAccountChange(null)} t={t} />
            {concurrentRoutingActive && account.autoSwitchEnabled
              && (accountConversationCounts[account.id] ?? 0) > 0 && (
              <span className="account-conversation-count"
                title={t("table.conversationCount", { count: accountConversationCounts[account.id] })}
                aria-label={t("table.conversationCount", { count: accountConversationCounts[account.id] })}>
                {accountConversationCounts[account.id] > 99 ? "99+" : accountConversationCounts[account.id]}
              </span>
            )}
          </div>
          <div className="account-primary">
            <div className="account-email-row">
              <CopyableAccountEmail email={account.email}
                displayEmail={privacyMode ? maskAccountEmail(account.email) : account.email} t={t} />
              <AccountResetCreditCount count={resetCreditsCount(resetCredits[account.id])} language={language} />
            </div>
            <AccountNoteEditButton account={account} hideAccountNotes={hideAccountNotes}
              onEdit={() => openAccountDetails(account)} t={t} />
            <div className="account-meta">
              <Tooltip title={account.accountId ? t("table.workspace", { id: account.accountId }) : t("table.personal")}>
                <Tag className="plan-tag">{account.plan || "ChatGPT"}</Tag>
              </Tooltip>
              {account.official && <Tag className="official-account-tag">{t("table.official")}</Tag>}
              <div className="updated-cell">
                {accountExpirationDate(account.expiresAt, account.usage.apiExpiresAt) && (
                  <span className="plan-expiration">{t("table.expiresAt", {
                    date: accountExpirationDate(account.expiresAt, account.usage.apiExpiresAt) ?? "",
                  })}</span>
                )}
                {shouldShowUsageError(account.usage.error, showUsageNetworkErrors)
                  && <Tooltip title={account.usage.error}>
                    <Tag color="error" className="account-error-tag" icon={<CircleHelp size={12} aria-hidden="true" />}>
                      {t("table.error")}
                    </Tag>
                  </Tooltip>}
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: t("accounts.group.column"), key: "group", dataIndex: "group", width: 150,
      sorter: (left, right) => left.group.localeCompare(right.group),
      filters: [
        { text: t("accounts.group.ungrouped"), value: "" },
        ...groups.map((group) => ({ text: group, value: group })),
      ],
      onFilter: (value, account) => account.group === value,
      render: (_, account) => <AccountGroupCell account={account} groups={groups}
        onChange={onAccountGroupChange} t={t} />,
    },
    {
      title: t("table.fiveHours"), key: "fiveHours", width: 260,
      sorter: (left, right, sortOrder) => compareKeepingAttentionLast(
        left,
        right,
        hotSwitchEnabled,
        showUsageNetworkErrors,
        sortOrder,
        (first, second) => compareUsageRemaining(first, second, "primary"),
      ),
      sortOrder: usageSort?.column === "fiveHours" ? usageSort.order : null,
      // OpenAI currently reports the primary (5-hour) quota with a weekly reset window.
      // Render its reset time like the weekly quota so it does not show a misleading 5-hour countdown.
      render: (_, account) => <UsageMeter window={account.usage.primary} resetWindow="oneWeek"
        fetchedAt={account.usage.fetchedAt} language={language} t={t} />,
    },
    {
      title: t("table.oneWeek"), key: "oneWeek", width: 260,
      sorter: (left, right, sortOrder) => compareKeepingAttentionLast(
        left,
        right,
        hotSwitchEnabled,
        showUsageNetworkErrors,
        sortOrder,
        (first, second) => compareUsageRemaining(first, second, "secondary"),
      ),
      sortOrder: usageSort?.column === "oneWeek" ? usageSort.order : null,
      render: (_, account) => <UsageMeter window={account.usage.secondary} resetWindow="oneWeek"
        language={language} t={t} />,
    },
    {
      title: <AccountCreditsTitle refreshing={refreshingAllUsage} onRefresh={onRefreshAllUsage} t={t} />,
      key: "credits", width: 140, align: "center" as const,
      render: (_: unknown, account: Account) => <AccountCredits credits={account.usage.credits}
        language={language} t={t} />,
    },
    {
      title: t("table.tokenTotals"), key: "tokenTotals", width: 92, align: "center" as const,
      render: (_: unknown, account: Account) => (
        <div className="account-token-chart-cell">
          <CompactDailyTokenChart
            totals={usageForAccount(account).totals}
            language={language} />
        </div>
      ),
    },
    {
      title: <TokenCostColumnTitle label={t("table.estimatedTokenCost")}
        settings={tokenCostDisplay} providers={providers} t={t} />,
      key: "estimatedCost", width: 145, align: "center" as const,
      render: (_: unknown, account: Account) => {
        const usage = usageForAccount(account);
        return <Tooltip title={t("table.estimatedTokenCostHint", { unit: tokenCostDisplay.unit })}
          styles={{ root: { maxWidth: 400 } }}>
          <strong className={`account-token-cost${fastModeEnabled ? " token-cost-burning" : ""}`}>
            {formatEstimatedCost(usage.estimatedCost, tokenCostDisplay)}
          </strong>
        </Tooltip>;
      },
    },
    {
      title: officialUsageLabels(language, tokenCostDisplay.unit).remaining,
      key: "availableQuota", width: 190, align: "center" as const,
      render: (_: unknown, account: Account) => <AvailableQuota account={officialUsageById.get(account.id)}
        language={language} settings={tokenCostDisplay} />,
    },
    ...(customPriorityActive ? [{
      title: t("table.autoSwitchPriority"), key: "autoSwitchPriority", width: 150,
      align: "center" as const, fixed: "right" as const,
      render: (_: unknown, account: Account) => (
        <AutoSwitchPriorityInput account={account} t={t}
          disabled={autoSwitchPriorityBusyAccountId !== null}
          onSave={onAutoSwitchPriorityChange} />
      ),
    }] : []),
    ...(customThresholdActive ? [{
      title: <GlobalAutoSwitchThresholdControl threshold={globalAutoSwitchThreshold}
        disabled={concurrentAccountRoutingBusy}
        onSave={onGlobalAutoSwitchThresholdChange} t={t} />,
      key: "autoSwitchThreshold", width: 170,
      align: "center" as const, fixed: "right" as const,
      render: (_: unknown, account: Account) => (
        <AutoSwitchThresholdInput account={account}
          disabled={autoSwitchThresholdBusyAccountId !== null}
          onSave={onAutoSwitchThresholdChange} t={t} />
      ),
    }] : []),
    {
      title: t("table.actions"), key: "actions", width: 95, align: "center", fixed: "right",
      className: "account-actions-column",
      render: (_, account) => {
        const waiting = busyAccountId === account.id;
        const resetWaiting = resetCreditBusyAccountId === account.id;
        const officialAuthActive = openaiAuthAccountId === account.id;
        const officialAuthUnsupported = Boolean(account.agentIdentity) && !officialAuthActive;
        const switchBlocked = hotSwitchEnabled
          ? !account.localProxyCompatible
          : !account.directSwitchCompatible;
        const switchBlockedReason = hotSwitchEnabled
          ? t("providers.proxy.agentIdentityUnsupported")
          : t("providers.proxy.agentIdentityProxyOnly");
        return (
          <Space size={4} className="table-actions">
            {!concurrentRoutingActive && (
              <Tooltip title={!account.active && switchBlocked ? switchBlockedReason : undefined}>
                <span>
                  {account.active ? (
                    <Popconfirm title={t("table.deactivateConfirmTitle")}
                      description={<span>{t("table.deactivateConfirmDescription")}</span>}
                      okText={t("table.deactivate")} cancelText={t("table.deactivateCancel")}
                      okButtonProps={{ danger: true }}
                      styles={{ root: { maxWidth: 400 } }}
                      onConfirm={() => onDeactivate(account.id)}>
                      <Button danger size="small" loading={waiting}>
                        {t("table.deactivate")}
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button size="small" type="primary" disabled={switchBlocked}
                      loading={waiting} onClick={() => onSwitch(account.id)}>
                      {t("table.switch")}
                    </Button>
                  )}
                </span>
              </Tooltip>
            )}
            <Dropdown trigger={["click"]} placement="bottomRight"
              open={tableActionMenuAccountId === account.id}
              onOpenChange={(open) => setTableActionMenuAccountId(open ? account.id : null)}
              dropdownRender={() => (
                <div className="account-action-menu" onClick={(event) => event.stopPropagation()}>
                  {hotSwitchEnabled && (
                    <Tooltip placement="left" classNames={{ root: "openai-auth-action-tooltip" }} title={(
                      <div className="openai-auth-action-tooltip-content">
                        <p>{t("providers.proxy.openaiAuthAccountTooltipRemote")}</p>
                        <p>{t("providers.proxy.openaiAuthAccountTooltipCapabilities")}</p>
                        {officialAuthUnsupported && (
                          <p className="warning">{t("providers.error.openaiAuthAccountOAuthRequired")}</p>
                        )}
                      </div>
                    )}>
                      <button type="button" className={officialAuthActive ? "destructive" : undefined}
                        disabled={openaiAuthBusy || officialAuthUnsupported}
                        onClick={() => {
                          setTableActionMenuAccountId(null);
                          requestOpenaiAuthAccountChange(officialAuthActive ? null : account.id);
                        }}>
                        {officialAuthActive ? <LogOut size={14} /> : <LogIn size={14} />}
                        {t(officialAuthActive
                          ? "providers.proxy.deactivateOpenaiAuthAccount"
                          : "providers.proxy.activateOpenaiAuthAccount")}
                      </button>
                    </Tooltip>
                  )}
                  <Popconfirm title={t("table.useResetCreditConfirmTitle")}
                    description={<span className="reset-credit-confirm-description">{t("table.useResetCreditConfirmDescription")}</span>}
                    okText={t("table.useResetCreditOk")} cancelText={t("table.cancel")}
                    classNames={{ root: "reset-credit-popconfirm" }}
                    styles={{ root: { width: 320, maxWidth: "calc(100vw - 32px)" } }}
                    disabled={waiting || resetWaiting}
                    onConfirm={() => {
                      setTableActionMenuAccountId(null);
                      onUseResetCredit(account.id);
                    }}>
                    <button type="button" disabled={waiting || resetWaiting}>
                      <CalendarClock size={14} />
                      {resetWaiting ? t("table.resetCreditsRefreshing") : t("table.useResetCredit")}
                    </button>
                  </Popconfirm>
                  <button type="button" disabled={waiting} onClick={() => {
                    setTableActionMenuAccountId(null);
                    onRefresh(account.id);
                  }}>
                    <RefreshCw size={14} />
                    {t("table.refreshUsage")}
                  </button>
                  <button type="button" onClick={() => {
                    setTableActionMenuAccountId(null);
                    onCopyAuthJson(account.id);
                  }}>
                    <Copy size={14} />
                    {t("table.copyAuthJson")}
                  </button>
                  {hotSwitchEnabled && (
                    <Tooltip title={t("table.autoSwitchTooltip")} placement="left">
                      <button type="button"
                        disabled={autoSwitchBusyAccountId !== null || bulkEnableBusy || bulkDisableBusy}
                        onClick={() => {
                          setTableActionMenuAccountId(null);
                          onAutoSwitchEnabledChange(account.id, !account.autoSwitchEnabled);
                        }}>
                        {account.autoSwitchEnabled ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
                        {account.autoSwitchEnabled ? t("table.disableAutoSwitch") : t("table.enableAutoSwitch")}
                      </button>
                    </Tooltip>
                  )}
                  <div className="account-action-menu-divider" />
                  <Popconfirm title={t("table.deleteConfirmTitle")} description={t("table.deleteConfirmDescription")}
                    okText={t("table.delete")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
                    disabled={account.active}
                    onConfirm={() => {
                      setTableActionMenuAccountId(null);
                      onDelete(account.id);
                    }}>
                    <button type="button" className="destructive" disabled={account.active}
                      title={account.active ? t("table.activeDeleteTooltip") : undefined}>
                      <Trash2 size={14} />
                      {t("table.delete")}
                    </button>
                  </Popconfirm>
                </div>
              )}>
              <Tooltip title={t("table.moreActions")}>
                <Button size="small" className="table-icon-button" aria-label={t("table.moreActions")}
                  icon={<MoreHorizontal size={16} />} />
              </Tooltip>
            </Dropdown>
          </Space>
        );
      },
    },
  ];
  const hiddenColumnSet = new Set(hiddenColumns);
  const baseColumnSettings: { key: AccountTableColumnKey; label: string }[] = [
    { key: "account", label: t("table.account") },
    { key: "group", label: t("accounts.group.column") },
    { key: "fiveHours", label: t("table.fiveHours") },
    { key: "oneWeek", label: t("table.oneWeek") },
    { key: "credits", label: t("table.credits") },
    { key: "tokenTotals", label: t("table.tokenTotals") },
    { key: "estimatedCost", label: t("table.estimatedTokenCost") },
    { key: "availableQuota", label: officialUsageLabels(language, tokenCostDisplay.unit).remaining },
    ...(customPriorityActive
      ? [{ key: "autoSwitchPriority" as const, label: t("table.autoSwitchPriority") }]
      : []),
    ...(customThresholdActive
      ? [{ key: "autoSwitchThreshold" as const, label: t("table.autoSwitchThreshold") }]
      : []),
    { key: "actions", label: t("table.actions") },
  ];
  const columnLabels = new Map(baseColumnSettings.map(({ key, label }) => [key, label]));
  const availableColumnKeys = new Set(baseColumnSettings.map(({ key }) => key));
  const columnSettings: { key: AccountTableColumnKey; label: string }[] = [
    { key: "account", label: columnLabels.get("account") ?? t("table.account") },
    ...columnOrder
      .filter((key) => availableColumnKeys.has(key))
      .map((key) => ({ key, label: columnLabels.get(key) ?? key })),
    { key: "actions", label: columnLabels.get("actions") ?? t("table.actions") },
  ];
  const columnsByKey = new Map(
    columns
      .filter((column) => isAccountTableColumnKey(column.key))
      .map((column) => [column.key as AccountTableColumnKey, column]),
  );
  const orderedColumns = [
    ...columns.filter((column) => !isAccountTableColumnKey(column.key)),
    ...columnSettings
      .map(({ key }) => columnsByKey.get(key))
      .filter((column): column is NonNullable<typeof column> => column != null),
  ];
  const visibleColumns = orderedColumns.filter((column) =>
    !isAccountTableColumnKey(column.key) || !hiddenColumnSet.has(column.key));
  const visibleConfigurableColumnCount = columnSettings
    .filter(({ key }) => !hiddenColumnSet.has(key)).length;
  const tableScrollX = 68 + visibleColumns.reduce(
    (total, column) => total + (typeof column.width === "number" ? column.width : 0),
    0,
  );
  const setColumnVisible = (key: AccountTableColumnKey, visible: boolean) => {
    if (key === "group") window.localStorage.setItem(GROUP_COLUMN_PREFERENCE_STORAGE_KEY, "true");
    setHiddenColumns((current) => {
      if (!visible && !current.includes(key) && visibleConfigurableColumnCount <= 1) return current;
      const next = visible
        ? current.filter((column) => column !== key)
        : [...new Set([...current, key])];
      persistHiddenColumns(next);
      return next;
    });
  };

  const reorderColumn = (
    source: ReorderableAccountTableColumnKey,
    target: ReorderableAccountTableColumnKey,
  ) => {
    if (source === target) return;
    setColumnOrder((current) => {
      const sourceIndex = current.indexOf(source);
      const targetIndex = current.indexOf(target);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = current.filter((key) => key !== source);
      next.splice(next.indexOf(target), 0, source);
      persistColumnOrder(next);
      return next;
    });
  };

  const moveColumn = (key: ReorderableAccountTableColumnKey, offset: number) => {
    setColumnOrder((current) => {
      const sourceIndex = current.indexOf(key);
      const targetIndex = Math.max(0, Math.min(current.length - 1, sourceIndex + offset));
      if (sourceIndex < 0 || sourceIndex === targetIndex) return current;
      const next = [...current];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, key);
      persistColumnOrder(next);
      return next;
    });
  };

  const tableContextAccount = contextMenu
    ? accounts.find((account) => account.id === contextMenu.accountId) ?? null
    : null;
  const tableContextMenu = tableContextAccount && contextMenu ? (() => {
    const account = tableContextAccount;
    const waiting = busyAccountId === account.id;
    const resetWaiting = resetCreditBusyAccountId === account.id;
    const switchBlocked = hotSwitchEnabled
      ? !account.localProxyCompatible
      : !account.directSwitchCompatible;
    const switchBlockedReason = hotSwitchEnabled
      ? t("providers.proxy.agentIdentityUnsupported")
      : t("providers.proxy.agentIdentityProxyOnly");
    const officialAuthActive = openaiAuthAccountId === account.id;
    const officialAuthUnsupported = Boolean(account.agentIdentity) && !officialAuthActive;

    return (
      <div ref={contextMenuRef} className="context-menu account-row-context-menu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(event) => event.stopPropagation()}>
        {!concurrentRoutingActive && (
          <Tooltip title={!account.active && switchBlocked ? switchBlockedReason : undefined} placement="left">
            {account.active ? (
              <Popconfirm title={t("table.deactivateConfirmTitle")}
                description={<span>{t("table.deactivateConfirmDescription")}</span>}
                okText={t("table.deactivate")} cancelText={t("table.deactivateCancel")}
                okButtonProps={{ danger: true }} styles={{ root: { maxWidth: 400 } }}
                onConfirm={() => {
                  setContextMenu(null);
                  onDeactivate(account.id);
                }}>
                <button type="button" className="destructive" disabled={waiting}>
                  <AccountUseActionIcon active />
                  {t("table.deactivate")}
                </button>
              </Popconfirm>
            ) : (
              <button type="button" disabled={switchBlocked || waiting}
                onClick={() => {
                  setContextMenu(null);
                  onSwitch(account.id);
                }}>
                <AccountUseActionIcon active={false} />
                {t("table.switch")}
              </button>
            )}
          </Tooltip>
        )}
        {hotSwitchEnabled && (
          <Tooltip placement="left" classNames={{ root: "openai-auth-action-tooltip" }} title={(
            <div className="openai-auth-action-tooltip-content">
              <p>{t("providers.proxy.openaiAuthAccountTooltipRemote")}</p>
              <p>{t("providers.proxy.openaiAuthAccountTooltipCapabilities")}</p>
              {officialAuthUnsupported && (
                <p className="warning">{t("providers.error.openaiAuthAccountOAuthRequired")}</p>
              )}
            </div>
          )}>
            <button type="button" className={officialAuthActive ? "destructive" : undefined}
              disabled={openaiAuthBusy || officialAuthUnsupported}
              onClick={() => {
                setContextMenu(null);
                requestOpenaiAuthAccountChange(officialAuthActive ? null : account.id);
              }}>
              {officialAuthActive ? <LogOut size={14} /> : <LogIn size={14} />}
              {t(officialAuthActive
                ? "providers.proxy.deactivateOpenaiAuthAccount"
                : "providers.proxy.activateOpenaiAuthAccount")}
            </button>
          </Tooltip>
        )}
        {hotSwitchEnabled && (
          <Tooltip title={t("table.autoSwitchTooltip")} placement="left">
            <button type="button"
              disabled={autoSwitchBusyAccountId !== null || bulkEnableBusy || bulkDisableBusy}
              onClick={() => {
                setContextMenu(null);
                onAutoSwitchEnabledChange(account.id, !account.autoSwitchEnabled);
              }}>
              {account.autoSwitchEnabled ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
              {account.autoSwitchEnabled ? t("table.disableAutoSwitch") : t("table.enableAutoSwitch")}
            </button>
          </Tooltip>
        )}
        <div className="context-menu-divider" />
        <Popconfirm title={t("table.useResetCreditConfirmTitle")}
          description={<span className="reset-credit-confirm-description">{t("table.useResetCreditConfirmDescription")}</span>}
          okText={t("table.useResetCreditOk")} cancelText={t("table.cancel")}
          classNames={{ root: "reset-credit-popconfirm" }}
          styles={{ root: { width: 320, maxWidth: "calc(100vw - 32px)" } }}
          disabled={waiting || resetWaiting}
          onConfirm={() => {
            setContextMenu(null);
            onUseResetCredit(account.id);
          }}>
          <button type="button" disabled={waiting || resetWaiting}>
            <CalendarClock size={14} />
            {resetWaiting ? t("table.resetCreditsRefreshing") : t("table.useResetCredit")}
          </button>
        </Popconfirm>
        <button type="button" onClick={() => {
          setContextMenu(null);
          setResetCreditsAccount(account);
          onLoadResetCredits(account.id);
        }}>
          <CalendarClock size={14} />
          {t("table.viewResetCredits")}
        </button>
        <button type="button" disabled={waiting} onClick={() => {
          setContextMenu(null);
          onRefresh(account.id);
        }}>
          <RefreshCw size={14} />
          {t("table.refreshUsage")}
        </button>
        <button type="button" onClick={() => {
          setContextMenu(null);
          onCopyAuthJson(account.id);
        }}>
          <Copy size={14} />
          {t("table.copyAuthJson")}
        </button>
        <button type="button" disabled={!canEditAccountMetadata(account)}
          title={!canEditAccountMetadata(account) ? t("table.officialMetadataReadOnly") : undefined}
          onClick={() => {
          setContextMenu(null);
          openAccountDetails(account);
        }}>
          <Pencil size={14} />
          {t("table.editNoteAndExpiry")}
        </button>
        <div className="context-menu-divider" />
        <Popconfirm title={t("table.deleteConfirmTitle")} description={t("table.deleteConfirmDescription")}
          okText={t("table.delete")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
          disabled={account.active}
          onConfirm={() => {
            setContextMenu(null);
            onDelete(account.id);
          }}>
          <button type="button" className="destructive" disabled={account.active}
            title={account.active ? t("table.activeDeleteTooltip") : undefined}>
            <Trash2 size={14} />
            {t("table.delete")}
          </button>
        </Popconfirm>
      </div>
    );
  })() : null;

  const accountToolbarSummary = (
    <div className="account-table-toolbar-summary">
      <span>
        {t("table.currentAccountLabel")}{language === "zh" ? "：" : ": "}
        <Select size="small" className="account-summary-select" value={activeAccount?.id}
          allowClear showSearch optionFilterProp="label" title={privacyMode ? undefined : activeAccount?.email}
          options={accountSelectOptions} loading={busyAccountId !== null}
          disabled={busyAccountId !== null || !accountSelectOptions.length}
          aria-label={t("table.currentAccountLabel")}
          onChange={(accountId) => {
            if (!accountId) {
              if (activeAccount) onDeactivate(activeAccount.id);
              return;
            }
            if (accountId !== activeAccount?.id) onSwitch(accountId);
          }} />
      </span>
      <Tooltip title={t(modelContextWindowTooltipKey(modelContextWindow.error))}
        styles={{ root: { maxWidth: 400 } }}>
        <span className="model-context-window-control">
          <span>{t("table.modelContextGlobal")}{language === "zh" ? "：" : ": "}</span>
          <AutoComplete value={modelContextWindow.valueK}
            options={GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS}
            placeholder={DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW_K}
            aria-label={t("table.modelContextWindow")}
            disabled={modelContextWindow.saving}
            status={modelContextWindow.error ? "error" : undefined}
            onChange={modelContextWindow.updateValueK}
            onBlur={() => void modelContextWindow.saveValueK(modelContextWindow.valueK)} />
          <span>K</span>
          <OfficialContextSettings models={modelContextWindow.models}
            valuesK={modelContextWindow.modelValuesK} saving={modelContextWindow.saving}
            onSave={modelContextWindow.saveModelValueK} onChange={modelContextWindow.updateModelValueK}
            onClear={modelContextWindow.clearModelValue} t={t} />
        </span>
      </Tooltip>
      {proxySpeedControl}
    </div>
  );
  const concurrentRoutingControl = <ConcurrentRoutingControl busy={concurrentAccountRoutingBusy}
    enabled={concurrentAccountRoutingEnabled} groups={groups} hotSwitchEnabled={hotSwitchEnabled}
    selectedGroup={concurrentAccountGroup} onChange={onConcurrentAccountRoutingChange} t={t} />;
  const batchConsumeControl = (
    <Popconfirm title={t("table.batchConsumeQuotaConfirmTitle", {
      count: consumableSelectedAccountIds.length,
    })} okText={t("table.batchConsumeQuotaOk")} cancelText={t("table.cancel")}
      onOpenChange={setBulkConsumeQuotaConfirmOpen}
      disabled={!consumableSelectedAccountIds.length || bulkConsumeQuotaBusy
        || bulkDeleteBusy || bulkEnableBusy || bulkDisableBusy
        || autoSwitchBusyAccountId !== null}
      onConfirm={async () => {
        const ids = [...consumableSelectedAccountIds];
        setBulkConsumeQuotaBusy(true);
        try {
          await onConsumeQuotaMany(ids);
        } finally {
          setBulkConsumeQuotaBusy(false);
        }
      }}>
      <Tooltip title={bulkConsumeQuotaConfirmOpen ? null : t("table.batchConsumeQuotaTooltip")}>
        <Button size="small" icon={<Gauge size={14} />} loading={bulkConsumeQuotaBusy}
          disabled={!consumableSelectedAccountIds.length || bulkDeleteBusy
            || bulkEnableBusy || bulkDisableBusy || autoSwitchBusyAccountId !== null}>
          {t("table.batchConsumeQuota")}
        </Button>
      </Tooltip>
    </Popconfirm>
  );

  if (displayMode === "cards") return <>
    {cardTopbarHost && createPortal(
      <div className="account-card-heading-controls">
        {accountToolbarSummary}
        {concurrentRoutingControl}
        {batchConsumeControl}
      </div>,
      cardTopbarHost,
    )}
    <div className={`${styles.styleScope} account-card-grid`}>
      {orderedAccounts.map((account) => {
        const waiting = busyAccountId === account.id;
        const isDisabled = isAccountDisabled(account, hotSwitchEnabled);
        const cardTokenUsage = usageForAccount(account);
        const switchBlocked = hotSwitchEnabled
          ? !account.localProxyCompatible
          : !account.directSwitchCompatible;
        const switchBlockedReason = hotSwitchEnabled
          ? t("providers.proxy.agentIdentityUnsupported")
          : t("providers.proxy.agentIdentityProxyOnly");
        return (
          <article key={account.id} className={[
            "account-card",
            isAccountHighlighted(
              account,
              concurrentRoutingActive,
              concurrentAccountGroup,
              customThresholdActive ? Math.max(account.autoSwitchThreshold, globalAutoSwitchThreshold) : null,
            ) ? "active" : "",
            isDisabled ? "account-alert-card" : "",
          ].filter(Boolean).join(" ")}
            title={switchBlocked ? switchBlockedReason : undefined}
            aria-disabled={switchBlocked}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button, a, input, textarea, summary, details")) return;
              setContextMenu(null);
              if (!concurrentRoutingActive && !account.active && !switchBlocked) onSwitch(account.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({
                accountId: account.id,
                ...contextMenuPosition(event, hotSwitchEnabled
                  ? ACCOUNT_CONTEXT_MENU_HEIGHT.hotSwitch
                  : ACCOUNT_CONTEXT_MENU_HEIGHT.directSwitch),
              });
            }}>
            <header className="account-head">
              <div className="account-card-avatar">
                <AccountAvatar email={account.email} disabled={isDisabled}
                  officialAuthActive={openaiAuthAccountId === account.id} busy={openaiAuthBusy} variant="card"
                  onClearOfficialAuth={() => requestOpenaiAuthAccountChange(null)} t={t} />
                {isDisabled && <span className="account-card-disabled-label">
                  {accountCardLabels(language).disabled}
                </span>}
              </div>
              <div className="identity">
                <div className="identity-line">
                  <CopyableAccountEmail email={account.email}
                    displayEmail={privacyMode ? maskAccountEmail(account.email) : account.email} t={t} />
                  <AccountResetCreditCount count={resetCreditsCount(resetCredits[account.id])}
                    language={language} />
                  <Tooltip title={account.accountId ? t("table.workspace", { id: account.accountId }) : t("table.personal")}>
                    <Tag className={`plan-tag${account.plan?.toLowerCase() === "free" ? " free-plan" : ""}`}>
                      {account.plan || "ChatGPT"}
                    </Tag>
                  </Tooltip>
                  {account.official && <Tag className="official-account-tag">{t("table.official")}</Tag>}
                </div>
                <AccountNoteEditButton account={account} hideAccountNotes={hideAccountNotes}
                  onEdit={() => openAccountDetails(account)} t={t} />
                <div className="plan-line">
                  {accountExpirationDate(account.expiresAt, account.usage.apiExpiresAt) && (
                    <span>{t("table.expiresAt", {
                      date: accountExpirationDate(account.expiresAt, account.usage.apiExpiresAt) ?? "",
                    })}</span>
                  )}
                  {shouldShowUsageError(account.usage.error, showUsageNetworkErrors)
                    && <Tooltip title={account.usage.error}>
                      <Tag color="error" className="account-error-tag" icon={<CircleHelp size={12} aria-hidden="true" />}>
                        {t("table.error")}
                      </Tag>
                    </Tooltip>}
                </div>
              </div>
              <div className="card-header-actions">
                <Tooltip title={t("table.refreshUsage")}><Button size="small" className="table-icon-button" loading={waiting}
                  aria-label={t("table.refreshUsage")}
                  icon={<RefreshCw size={19} />} onClick={() => onRefresh(account.id)} /></Tooltip>
                <UsageRefreshAge fetchedAt={account.usage.fetchedAt} t={t} />
              </div>
            </header>
            <AccountCardAutoSwitchSettings account={account} t={t}
              priorityEnabled={customPriorityActive} thresholdEnabled={customThresholdActive}
              priorityBusy={autoSwitchPriorityBusyAccountId !== null}
              thresholdBusy={autoSwitchThresholdBusyAccountId !== null}
              onPrioritySave={onAutoSwitchPriorityChange} onThresholdSave={onAutoSwitchThresholdChange} />
            <div className="account-card-usage">
              <section>
                <UsageMeter window={account.usage.primary} resetWindow="oneWeek"
                  fetchedAt={account.usage.fetchedAt} variant="card"
                  cardLabel={t("usage.primaryMarker")} cardLabelSuffix={t("usage.unit")}
                  language={language} t={t} />
              </section>
              <section>
                <UsageMeter window={account.usage.secondary} resetWindow="oneWeek"
                  variant="card" cardLabel={t("usage.secondaryMarker")} cardLabelSuffix={t("usage.unit")}
                  language={language} t={t} />
              </section>
            </div>
            <AccountCardFooter usage={cardTokenUsage} display={tokenCostDisplay} language={language} t={t} />
          </article>
        );
      })}
    </div>
    {tableContextMenu}
    {editingAccount && <AccountNoteModal key={editingAccount.id} account={editingAccount}
      loading={loadingAccountDetailsId === editingAccount.id}
      onClose={() => setEditingAccount(null)}
      onSave={(details) => onSaveNote(editingAccount.id, details)} t={t} />}
    {resetCreditsAccount && <ResetCreditsModal state={resetCredits[resetCreditsAccount.id]} onClose={() => setResetCreditsAccount(null)}
      onRetry={() => onLoadResetCredits(resetCreditsAccount.id, true)} language={language} t={t} />}
  </>;

  return <>
    <div ref={tableWrapRef} className={`${styles.styleScope} account-table-wrap`}>
      <div className="account-table-toolbar">
        {accountToolbarSummary}
        {concurrentRoutingControl}
        {batchConsumeControl}
        <Popconfirm title={t("table.batchDeleteConfirmTitle", { count: deletableSelectedAccountIds.length })}
          description={t("table.batchDeleteConfirmDescription")}
          okText={t("table.delete")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
          disabled={!deletableSelectedAccountIds.length || bulkConsumeQuotaBusy
            || bulkDeleteBusy || bulkEnableBusy || bulkDisableBusy}
          onConfirm={async () => {
            const ids = [...deletableSelectedAccountIds];
            setBulkDeleteBusy(true);
            try {
              const deletedIds = await onDeleteMany(ids);
              const deletedIdSet = new Set(deletedIds);
              setSelectedAccountIds((current) => current.filter((id) => !deletedIdSet.has(id)));
            } finally {
              setBulkDeleteBusy(false);
            }
          }}>
          <Button danger size="small" icon={<Trash2 size={14} />} loading={bulkDeleteBusy}
            disabled={!deletableSelectedAccountIds.length || bulkConsumeQuotaBusy
              || bulkEnableBusy || bulkDisableBusy}>
            {t("table.batchDelete", { count: deletableSelectedAccountIds.length })}
          </Button>
        </Popconfirm>
        {hotSwitchEnabled && (
          <Button type="primary" size="small" icon={<ToggleRight size={14} />} loading={bulkEnableBusy}
            disabled={!enableableSelectedAccountIds.length || bulkConsumeQuotaBusy
              || bulkDeleteBusy || bulkDisableBusy
              || autoSwitchBusyAccountId !== null}
            onClick={async () => {
              const ids = [...enableableSelectedAccountIds];
              setBulkEnableBusy(true);
              try {
                await onEnableMany(ids);
              } finally {
                setBulkEnableBusy(false);
              }
            }}>
            {t("table.batchEnable", { count: enableableSelectedAccountIds.length })}
          </Button>
        )}
        {hotSwitchEnabled && (
          <Button size="small" icon={<ToggleLeft size={14} />} loading={bulkDisableBusy}
            disabled={!disableableSelectedAccountIds.length || bulkConsumeQuotaBusy
              || bulkDeleteBusy || bulkEnableBusy
              || autoSwitchBusyAccountId !== null}
            onClick={async () => {
              const ids = [...disableableSelectedAccountIds];
              setBulkDisableBusy(true);
              try {
                await onDisableMany(ids);
              } finally {
                setBulkDisableBusy(false);
              }
            }}>
            {t("table.batchDisable", { count: disableableSelectedAccountIds.length })}
          </Button>
        )}
        <Dropdown trigger={["click"]} placement="bottomRight"
          dropdownRender={() => (
            <div className="account-column-settings" onClick={(event) => event.stopPropagation()}>
              <strong>{t("table.columnSettings")}</strong>
              <div className="account-column-settings-list">
                {columnSettings.map(({ key, label }) => {
                  const checked = !hiddenColumnSet.has(key);
                  const reorderable = isReorderableAccountTableColumnKey(key);
                  return (
                    <div key={key}
                      data-account-table-column-key={key}
                      className={[
                        "account-column-setting-item",
                        draggedColumn === key ? "is-dragging" : "",
                        dragTargetColumn === key ? "is-drag-target" : "",
                      ].filter(Boolean).join(" ")}>
                      {reorderable ? (
                        <span className="account-column-drag-handle" role="button" tabIndex={0}
                          title={t("table.columnOrderDrag", { column: label })}
                          aria-label={t("table.columnOrderDrag", { column: label })}
                          onPointerDown={(event) => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            draggedColumnRef.current = key;
                            setDraggedColumn(key);
                          }}
                          onPointerMove={(event) => {
                            if (!draggedColumnRef.current) return;
                            const item = document.elementFromPoint(event.clientX, event.clientY)
                              ?.closest<HTMLElement>("[data-account-table-column-key]");
                            const target = item?.dataset.accountTableColumnKey;
                            setDragTargetColumn(
                              isReorderableAccountTableColumnKey(target) ? target : null,
                            );
                          }}
                          onPointerUp={(event) => {
                            const source = draggedColumnRef.current;
                            const item = document.elementFromPoint(event.clientX, event.clientY)
                              ?.closest<HTMLElement>("[data-account-table-column-key]");
                            const target = item?.dataset.accountTableColumnKey;
                            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                              event.currentTarget.releasePointerCapture(event.pointerId);
                            }
                            draggedColumnRef.current = null;
                            setDraggedColumn(null);
                            setDragTargetColumn(null);
                            if (source && isReorderableAccountTableColumnKey(target)) {
                              reorderColumn(source, target);
                            }
                          }}
                          onPointerCancel={() => {
                            draggedColumnRef.current = null;
                            setDraggedColumn(null);
                            setDragTargetColumn(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                            event.preventDefault();
                            moveColumn(key, event.key === "ArrowUp" ? -1 : 1);
                          }}>
                          <GripVertical size={14} aria-hidden="true" />
                        </span>
                      ) : (
                        <Tooltip title={t(key === "account"
                          ? "table.columnOrderFixedFirst"
                          : "table.columnOrderFixedLast")}>
                          <span className="account-column-fixed-icon">
                            <Lock size={12} aria-hidden="true" />
                          </span>
                        </Tooltip>
                      )}
                      <Checkbox checked={checked}
                        disabled={checked && visibleConfigurableColumnCount <= 1}
                        onChange={(event) => setColumnVisible(key, event.target.checked)}>
                        {label}
                      </Checkbox>
                    </div>
                  );
                })}
              </div>
            </div>
          )}>
          <Tooltip title={t("table.columnSettings")}>
            <Button size="small" className="table-icon-button"
              aria-label={t("table.columnSettings")} icon={<Columns3 size={15} />} />
          </Tooltip>
        </Dropdown>
      </div>
      <Table rowKey="id" size="small" tableLayout="fixed" columns={visibleColumns} dataSource={orderedAccounts} pagination={false}
        onChange={handleTableChange}
        rowSelection={{
          fixed: true,
          columnWidth: 36,
          selectedRowKeys: selectedAccountIds,
          onChange: (keys) => setSelectedAccountIds(keys.map(String)),
        }}
        rowClassName={(account) => [
          isAccountHighlighted(
            account,
            concurrentRoutingActive,
            concurrentAccountGroup,
            customThresholdActive ? Math.max(account.autoSwitchThreshold, globalAutoSwitchThreshold) : null,
          ) ? "active-row" : "",
          isAccountDisabled(account, hotSwitchEnabled) ? "account-alert-row" : "",
          customThresholdActive && account.usage.primary?.remainingPercent !== undefined
            && account.usage.primary.remainingPercent
              < Math.max(account.autoSwitchThreshold, globalAutoSwitchThreshold)
            ? "account-threshold-row" : "",
        ].filter(Boolean).join(" ")}
        onRow={(account) => ({
          onContextMenu: (event) => {
            event.preventDefault();
            setTableActionMenuAccountId(null);
            setContextMenu({
              accountId: account.id,
              ...contextMenuPosition(event, hotSwitchEnabled
                ? ACCOUNT_CONTEXT_MENU_HEIGHT.hotSwitch
                : ACCOUNT_CONTEXT_MENU_HEIGHT.directSwitch),
            });
          },
        })}
        expandable={{
          columnWidth: 32,
          fixed: "left",
          expandedRowRender: (account) => <AccountExpandedPanel account={account}
            resetCredits={resetCredits[account.id]} privacyMode={privacyMode} hideAccountNotes={hideAccountNotes}
            onRefreshResetCredits={() => onLoadResetCredits(account.id, true)} language={language} t={t} />,
          onExpand: (expanded, account) => { if (expanded) void onLoadAccountDetails(account.id); },
        }}
        scroll={tableScrollY ? { x: tableScrollX, y: tableScrollY } : { x: tableScrollX }} />
    </div>
    {tableContextMenu}
    {editingAccount && <AccountNoteModal key={editingAccount.id} account={editingAccount}
      loading={loadingAccountDetailsId === editingAccount.id}
      onClose={() => setEditingAccount(null)}
      onSave={(details) => onSaveNote(editingAccount.id, details)} t={t} />}
    {resetCreditsAccount && <ResetCreditsModal state={resetCredits[resetCreditsAccount.id]} onClose={() => setResetCreditsAccount(null)}
      onRetry={() => onLoadResetCredits(resetCreditsAccount.id, true)} language={language} t={t} />}
  </>;
}
