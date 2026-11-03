import { t } from './i18n';
import { assertUsageOwner, preserveLatestUsage, runRemoteUsage, usageOwner, usageUpdatedAt } from './accounts/remoteUsage';
import { mergeRemoteModelState, remoteModelPath, type RemoteModelTarget } from '../../../shared/remote-chat/modelTarget';
import { configureStore, createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  apiJson,
  fetchDashboardData,
  getActiveSession,
  loadStoredSession,
  login,
  logout,
  restartRemoteDeviceCodex,
  subscribeSession,
  switchRemoteDeviceProvider,
  switchRemoteDeviceProviderGroup,
} from "./api";
import type {
  AccountSummary,
  AppPage,
  AuthSession,
  DeviceStatusSocketMessage,
  RemoteDevice,
  RemoteModelSwitchResult,
  RemoteProviderSummary,
  UserProfile,
} from "./types";

interface AuthState {
  session: AuthSession | null;
  initialized: boolean;
  submitting: boolean;
  error: string | null;
}

interface DataState {
  accounts: AccountSummary[];
  providers: RemoteProviderSummary[];
  devices: RemoteDevice[];
  profile: UserProfile | null;
  page: AppPage;
  loading: boolean;
  refreshing: boolean;
  consumingQuota: boolean;
  selectedChatDeviceId: string | null;
  refreshingAccountId: string | null;
  deletingDeviceId: string | null;
  switchingAccountId: string | null;
  switchingProvider: { deviceId: string; providerId: string } | null;
  switchingOpenAiAuth: { deviceId: string; accountId: string } | null;
  restartingDeviceId: string | null;
  lastRefreshAt: number | null;
  error: string | null;
}

const messageOf = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return t("client.app.anUnexpectedErrorOccurred");
};

export const bootstrapApp = createAsyncThunk("auth/bootstrap", async () => {
  const session = loadStoredSession();
  if (!session) return { session: null, data: null };
  try {
    const data = await fetchDashboardData();
    return { session: getActiveSession(), data };
  } catch (error) {
    if (!getActiveSession()) return { session: null, data: null };
    return { session: getActiveSession(), data: null, error: messageOf(error) };
  }
});

export const signIn = createAsyncThunk(
  "auth/signIn",
  async (payload: { baseUrl: string; email: string; password: string }) => {
    await login(payload.baseUrl, payload.email, payload.password);
    // API authorization alone expires a session; loading failures remain retryable.
    const data = await fetchDashboardData();
    return { session: getActiveSession(), data };
  },
);

export const signOut = createAsyncThunk("auth/signOut", async () => {
  await logout();
});

const usageBusy = (state: { data: DataState }) =>
  state.data.refreshing || state.data.consumingQuota || Boolean(state.data.refreshingAccountId);

export const refreshAll = createAsyncThunk("data/refreshAll", async (_, { getState }) => {
  const owner = usageOwner();
  const data = await fetchDashboardData();
  assertUsageOwner(owner);
  const current = (getState() as { data: DataState }).data;
  const accounts = preserveLatestUsage(data.accounts, current.accounts);
  try {
    const result = await runRemoteUsage({ accounts, devices: data.devices,
      selectedDeviceId: current.selectedChatDeviceId, action: 'refresh' });
    return { ...data, accounts: result.accounts, error: result.failed
      ? t("client.accountUsage.usageCouldNotBeRefreshedForAccountsTryAgainLater", { count: result.failed }) : null };
  } catch (error) {
    assertUsageOwner(owner);
    // Metadata still updates when the selected PC is unavailable.
    return { ...data, accounts, error: messageOf(error) };
  }
}, {
  condition: (_, { getState }) => !usageBusy(getState() as { data: DataState }),
});

export const refreshOneAccount = createAsyncThunk("data/refreshAccount", async (accountId: string, { getState }) => {
  const state = (getState() as { data: DataState }).data;
  const result = await runRemoteUsage({ accounts: state.accounts.filter(account => account.id === accountId),
    devices: state.devices, selectedDeviceId: state.selectedChatDeviceId, action: 'refresh' });
  const usage = result.accounts[0]?.usage;
  if (!usage || usage.error) throw new Error(usage?.error || t("client.accountUsage.couldNotRefreshUsagePleaseTryAgainLater"));
  return { accountId, usage };
}, { condition: (_, { getState }) => !usageBusy(getState() as { data: DataState }) });

export const consumeQuota = createAsyncThunk('data/consumeQuota', async (accountIds: string[], { getState }) => {
  const state = (getState() as { data: DataState }).data;
  return runRemoteUsage({ accounts: state.accounts.filter(account => accountIds.includes(account.id)),
    devices: state.devices, selectedDeviceId: state.selectedChatDeviceId, action: 'consume' });
}, { condition: (_, { getState }) => !usageBusy(getState() as { data: DataState }) });

export const removeDevice = createAsyncThunk("data/removeDevice", async (deviceId: string) => {
  await apiJson(`/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
  return deviceId;
});

export const switchDeviceAccount = createAsyncThunk(
  "data/switchDeviceAccount",
  async ({ deviceId, accountId, target = 'proxy' }: {
    deviceId: string; accountId: string; target?: RemoteModelTarget;
  }) => ({
    accountId,
    result: await apiJson<RemoteModelSwitchResult>(
      `/devices/${encodeURIComponent(deviceId)}/${remoteModelPath('account', target)}`,
      { method: "POST", body: JSON.stringify({ accountId }) },
    ),
  }),
);

export const switchDeviceProvider = createAsyncThunk(
  "data/switchDeviceProvider",
  async ({ deviceId, providerId, target = 'proxy' }: {
    deviceId: string; providerId: string; target?: RemoteModelTarget;
  }) => ({
    providerId,
    result: await switchRemoteDeviceProvider(deviceId, providerId, target),
  }),
);

export const switchDeviceProviderGroup = createAsyncThunk(
  "data/switchDeviceProviderGroup",
  async ({ deviceId, group }: { deviceId: string; group: string }) => ({
    providerId: `group:${group}`,
    result: await switchRemoteDeviceProviderGroup(deviceId, group),
  }),
);

export const restartDeviceCodex = createAsyncThunk(
  "data/restartDeviceCodex",
  async (deviceId: string) => {
    await restartRemoteDeviceCodex(deviceId);
    return deviceId;
  },
);

export const setDeviceOpenAiAuthAccount = createAsyncThunk(
  "data/setDeviceOpenAiAuthAccount",
  async ({ deviceId, accountId }: { deviceId: string; accountId: string }) => ({
    accountId,
    result: await apiJson<{ deviceId: string; openaiAuthAccountId: string; online: boolean }>(
      `/devices/${encodeURIComponent(deviceId)}/openai-auth-account`,
      { method: "POST", body: JSON.stringify({ accountId }) },
    ),
  }),
);

function applyModelSwitchResult(
  devices: RemoteDevice[],
  result: RemoteModelSwitchResult,
): RemoteDevice[] {
  return devices.map((device) => device.deviceId === result.deviceId
    ? {
      ...mergeRemoteModelState(device, result),
      online: result.online,
    }
    : device);
}

const authSlice = createSlice({
  name: "auth",
  initialState: { session: null, initialized: false, submitting: false, error: null } as AuthState,
  reducers: {
    sessionUpdated(state, action: PayloadAction<AuthSession | null>) {
      state.session = action.payload;
    },
    clearError(state) { state.error = null; },
  },
  extraReducers: (builder) => builder
    .addCase(bootstrapApp.fulfilled, (state, action) => {
      state.session = action.payload.session;
      state.initialized = true;
    })
    .addCase(bootstrapApp.rejected, (state) => { state.initialized = true; })
    .addCase(signIn.pending, (state) => { state.submitting = true; state.error = null; })
    .addCase(signIn.fulfilled, (state, action) => {
      state.session = action.payload.session;
      state.submitting = false;
    })
    .addCase(signIn.rejected, (state, action) => {
      state.submitting = false;
      state.error = messageOf(action.error);
    }),
});

const initialDataState: DataState = {
  accounts: [], providers: [], devices: [], profile: null, page: "chat",
  loading: false, refreshing: false, refreshingAccountId: null, deletingDeviceId: null,
  consumingQuota: false, selectedChatDeviceId: null,
  switchingAccountId: null, switchingProvider: null, switchingOpenAiAuth: null,
  restartingDeviceId: null, lastRefreshAt: null, error: null,
};

const dataSlice = createSlice({
  name: "data",
  initialState: initialDataState,
  reducers: {
    pageChanged(state, action: PayloadAction<AppPage>) { state.page = action.payload; },
    chatDeviceSelected(state, action: PayloadAction<string | null>) { state.selectedChatDeviceId = action.payload; },
    deviceSocketMessage(state, action: PayloadAction<DeviceStatusSocketMessage>) {
      const message = action.payload;
      if (message.type === "devices-snapshot") {
        state.devices = message.devices;
      } else if (message.type === "device-online") {
        state.devices = [message.device, ...state.devices.filter((item) => item.deviceId !== message.device.deviceId)];
      } else if (message.type === "device-removed") {
        state.devices = state.devices.filter((item) => item.deviceId !== message.deviceId);
      } else {
        state.devices = state.devices.map((item) => item.deviceId === message.deviceId
          ? { ...item, online: false, lastSeenAt: message.lastSeenAt }
          : item);
      }
    },
    resetData() { return initialDataState; },
    clearError(state) { state.error = null; },
  },
  extraReducers: (builder) => builder
    .addCase(bootstrapApp.pending, (state) => { state.loading = true; })
    .addCase(bootstrapApp.fulfilled, (state, action) => {
      state.loading = false;
      if (action.payload.data) Object.assign(state, action.payload.data);
      state.lastRefreshAt = usageUpdatedAt(state.accounts);
      if ("error" in action.payload && action.payload.error) state.error = action.payload.error;
    })
    .addCase(bootstrapApp.rejected, (state, action) => {
      state.loading = false;
      state.error = messageOf(action.error);
    })
    .addCase(signIn.pending, (state) => { state.loading = true; })
    .addCase(signIn.fulfilled, (state, action) => {
      state.loading = false;
      Object.assign(state, action.payload.data);
      state.lastRefreshAt = usageUpdatedAt(state.accounts);
    })
    .addCase(signIn.rejected, (state, action) => {
      state.loading = false;
      state.error = messageOf(action.error);
    })
    .addCase(signOut.pending, () => initialDataState)
    .addCase(refreshAll.pending, (state) => { state.refreshing = true; state.error = null; })
    .addCase(refreshAll.fulfilled, (state, action) => {
      state.refreshing = false;
      Object.assign(state, action.payload);
      state.lastRefreshAt = usageUpdatedAt(state.accounts);
    })
    .addCase(refreshAll.rejected, (state, action) => {
      state.refreshing = false;
      state.error = messageOf(action.error);
    })
    .addCase(refreshOneAccount.pending, (state, action) => { state.refreshingAccountId = action.meta.arg; })
    .addCase(refreshOneAccount.fulfilled, (state, action) => {
      state.refreshingAccountId = null;
      state.accounts = state.accounts.map((account) => account.id === action.payload.accountId
        ? { ...account, plan: action.payload.usage.plan ?? account.plan, usage: action.payload.usage }
        : account);
      state.lastRefreshAt = usageUpdatedAt(state.accounts);
    })
    .addCase(refreshOneAccount.rejected, (state, action) => {
      state.refreshingAccountId = null;
      const refreshError = messageOf(action.error);
      state.accounts = state.accounts.map((account) => account.id === action.meta.arg
        ? {
          ...account,
          usage: {
            ...account.usage,
            error: refreshError,
          },
        }
        : account);
      state.error = refreshError;
    })
    .addCase(consumeQuota.pending, (state) => { state.consumingQuota = true; state.error = null; })
    .addCase(consumeQuota.fulfilled, (state, action) => {
      state.consumingQuota = false;
      const updated = new Map(action.payload.accounts.map(account => [account.id, account]));
      state.accounts = state.accounts.map(account => updated.get(account.id) ?? account);
      state.lastRefreshAt = usageUpdatedAt(state.accounts);
    })
    .addCase(consumeQuota.rejected, (state, action) => {
      state.consumingQuota = false;
      state.error = messageOf(action.error);
    })
    .addCase(removeDevice.pending, (state, action) => { state.deletingDeviceId = action.meta.arg; })
    .addCase(removeDevice.fulfilled, (state, action) => {
      state.deletingDeviceId = null;
      state.devices = state.devices.filter((item) => item.deviceId !== action.payload);
    })
    .addCase(removeDevice.rejected, (state, action) => {
      state.deletingDeviceId = null;
      state.error = messageOf(action.error);
    })
    .addCase(switchDeviceAccount.pending, (state, action) => { state.switchingAccountId = action.meta.arg.accountId; })
    .addCase(switchDeviceAccount.fulfilled, (state, action) => {
      state.switchingAccountId = null;
      state.devices = applyModelSwitchResult(state.devices, action.payload.result);
    })
    .addCase(switchDeviceAccount.rejected, (state, action) => {
      state.switchingAccountId = null;
      state.error = messageOf(action.error);
    })
    .addCase(switchDeviceProvider.pending, (state, action) => { state.switchingProvider = action.meta.arg; })
    .addCase(switchDeviceProvider.fulfilled, (state, action) => {
      state.switchingProvider = null;
      state.devices = applyModelSwitchResult(state.devices, action.payload.result);
    })
    .addCase(switchDeviceProvider.rejected, (state, action) => {
      state.switchingProvider = null;
      state.error = messageOf(action.error);
    })
    .addCase(switchDeviceProviderGroup.pending, (state, action) => {
      state.switchingProvider = {
        deviceId: action.meta.arg.deviceId,
        providerId: `group:${action.meta.arg.group}`,
      };
    })
    .addCase(switchDeviceProviderGroup.fulfilled, (state, action) => {
      state.switchingProvider = null;
      state.devices = applyModelSwitchResult(state.devices, action.payload.result);
    })
    .addCase(switchDeviceProviderGroup.rejected, (state, action) => {
      state.switchingProvider = null;
      state.error = messageOf(action.error);
    })
    .addCase(restartDeviceCodex.pending, (state, action) => { state.restartingDeviceId = action.meta.arg; })
    .addCase(restartDeviceCodex.fulfilled, (state) => { state.restartingDeviceId = null; })
    .addCase(restartDeviceCodex.rejected, (state, action) => {
      state.restartingDeviceId = null;
      state.error = messageOf(action.error);
    })
    .addCase(setDeviceOpenAiAuthAccount.pending, (state, action) => { state.switchingOpenAiAuth = action.meta.arg; })
    .addCase(setDeviceOpenAiAuthAccount.fulfilled, (state, action) => {
      state.switchingOpenAiAuth = null;
      state.devices = state.devices.map((device) => device.deviceId === action.payload.result.deviceId
        ? { ...device, openaiAuthAccountId: action.payload.result.openaiAuthAccountId, online: action.payload.result.online }
        : device);
    })
    .addCase(setDeviceOpenAiAuthAccount.rejected, (state, action) => {
      state.switchingOpenAiAuth = null;
      state.error = messageOf(action.error);
    }),
});

export const store = configureStore({ reducer: { auth: authSlice.reducer, data: dataSlice.reducer } });
subscribeSession((session) => store.dispatch(authSlice.actions.sessionUpdated(session)));

export const { pageChanged, chatDeviceSelected, deviceSocketMessage, resetData,
  clearError: clearDataError } = dataSlice.actions;
export const { clearError: clearAuthError } = authSlice.actions;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
