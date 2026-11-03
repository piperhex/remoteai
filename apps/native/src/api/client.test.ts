import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountSummary, AuthSession } from '../types';
import type { TotpVault } from '../totp/types';
import { activateSession, sessionEpoch } from './sessionStore';

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import {
  completeEmbeddedAccountOAuth,
  consumeResetCredit,
  deleteRemoteDevice,
  revokeDesktopService,
  fetchAccountSummary,
  fetchAccountUsage,
  fetchAccountUsageSummaries,
  fetchRemoteProviders,
  fetchTotpVault,
  fetchResetCredits,
  pollAccountOAuth,
  pollEmbeddedAccountOAuth,
  restartRemoteDeviceCodex,
  startAccountOAuth,
  startEmbeddedAccountOAuth,
  switchRemoteDeviceAccount,
  switchRemoteDeviceProvider,
  switchRemoteDeviceProviderGroup,
  syncTotpVault,
  updateAccountDetails,
} from './client';

const session: AuthSession = {
  baseUrl: 'https://switch.example.com',
  accessToken: 'switch-access',
  refreshToken: 'switch-refresh',
  email: 'owner@example.com',
};

function account(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'account-1',
    email: 'account@example.com',
    note: '',
    expiresAt: '',
    plan: 'plus',
    accountId: 'workspace-1',
    codexAccessToken: 'codex-access',
    active: true,
    usage: {},
    ...overrides,
  };
}

describe('mobile Codex API client', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await activateSession(session, sessionEpoch());
  });

  it('loads account metadata without refreshing Codex usage', async () => {
    const apiFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      accounts: [account({
        privateDetails: {
          password: 'account-password',
          phoneNumber: '+65 6123 4567',
          totpSecret: 'JBSWY3DPEHPK3PXP',
        },
        usage: {
          primary: { usedPercent: 99, remainingPercent: 1 },
          fetchedAt: '2026-01-01T00:00:00.000Z',
        },
      })],
    }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    const result = await fetchAccountSummary(session);

    expect(result[0]?.usage.primary?.usedPercent).toBe(99);
    expect(result[0]?.privateDetails).toEqual({
      password: 'account-password',
      phoneNumber: '+65 6123 4567',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe('https://switch.example.com/sync/accounts/summary');
  });

  it('refreshes all account usage from Codex', async () => {
    const apiFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      plan_type: 'pro',
      promo: {
        offer: {
          valid_until: '2026-08-31T12:30:00Z',
          ends_at: '2026-09-30T12:30:00Z',
        },
      },
      rate_limit: {
        primary_window: {
          used_percent: 25,
          limit_window_seconds: 18_000,
          reset_at: 1_800_000_000,
        },
        secondary_window: {
          used_percent: 40,
          limit_window_seconds: 604_800,
          reset_at: 1_800_100_000,
        },
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    const result = await fetchAccountUsageSummaries([account()]);

    expect(result[0]?.usage).toEqual(expect.objectContaining({
      primary: {
        usedPercent: 25,
        remainingPercent: 75,
        resetsAt: 1_800_000_000,
        windowMinutes: 300,
      },
      secondary: {
        usedPercent: 40,
        remainingPercent: 60,
        resetsAt: 1_800_100_000,
        windowMinutes: 10_080,
      },
      apiExpiresAt: '2026-08-31T12:30:00.000Z',
      plan: 'pro',
      error: null,
    }));
    expect(result[0]?.plan).toBe('pro');
    expect(apiFetch.mock.calls[0]?.[0]).toBe('https://chatgpt.com/backend-api/wham/usage');
    const headers = new Headers((apiFetch.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer codex-access');
    expect(headers.get('ChatGPT-Account-Id')).toBe('workspace-1');
    expect(headers.get('originator')).toBe('codex_cli_rs');
  });

  it('does not fall back to stale usage when no Codex token is available', async () => {
    const apiFetch = vi.fn();
    vi.stubGlobal('fetch', apiFetch);

    const result = await fetchAccountUsageSummaries([account({
      codexAccessToken: undefined,
      usage: {
        primary: { usedPercent: 10, remainingPercent: 90 },
        fetchedAt: '2026-01-01T00:00:00.000Z',
      },
    })]);

    expect(result[0]?.usage.primary).toBeNull();
    expect(result[0]?.usage.error).toContain('没有可用于手机直连的 Codex Token');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('refreshes one account usage without requesting the account list', async () => {
    const apiFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      rate_limit: {
        primary_window: {
          used_percent: 35,
          limit_window_seconds: 18_000,
          reset_at: 1_800_000_000,
        },
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(fetchAccountUsage(account())).resolves.toEqual(expect.objectContaining({
      primary: {
        usedPercent: 35,
        remainingPercent: 65,
        resetsAt: 1_800_000_000,
        windowMinutes: 300,
      },
      apiExpiresAt: null,
      plan: null,
      error: null,
    }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe('https://chatgpt.com/backend-api/wham/usage');
  });

  it('reads and normalizes reset credits directly from Codex', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      credits: [{
        granted_at: 1_753_056_000,
        expires_at: '2026-08-20T10:30:00.000Z',
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(fetchResetCredits(account())).resolves.toEqual({
      credits: [{
        issuedAt: '2025-07-21T00:00:00.000Z',
        expiresAt: '2026-08-20T10:30:00.000Z',
      }],
    });
    expect(apiFetch.mock.calls[0]?.[0])
      .toBe('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits');
  });

  it('checks current credits and consumes one directly through Codex', async () => {
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        credits: [{ granted_at: 1_753_056_000, expires_at: 1_756_000_000 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'reset' }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(consumeResetCredit(account())).resolves.toBeUndefined();

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[1]?.[0])
      .toBe('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume');
    const request = apiFetch.mock.calls[1]?.[1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body as string)).toEqual({
      redeem_request_id: expect.stringMatching(/^codex-switch-mobile-/),
    });
  });

  it('deletes an offline desktop device through the cloud API', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(deleteRemoteDevice(session, 'device/1')).resolves.toBeUndefined();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe(
      'https://switch.example.com/devices/device%2F1',
    );
    expect(apiFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    const headers = new Headers((apiFetch.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer switch-access');
  });

  it('revokes only the selected desktop service grant using account authentication', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', apiFetch);
    await expect(revokeDesktopService(session, 'device/1')).resolves.toBeUndefined();
    expect(apiFetch.mock.calls[0]?.[0]).toBe('https://switch.example.com/devices/device%2F1/service-credential');
    expect(apiFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    const headers = new Headers((apiFetch.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer switch-access');
  });

  it('loads safe provider summaries from the cloud API', async () => {
    const providers = [{ id: 'provider-1', name: 'Gateway', model: 'model-a', group: '工作' }];
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ providers }), {
      status: 200,
    }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(fetchRemoteProviders(session)).resolves.toEqual(providers);
    expect(apiFetch.mock.calls[0]?.[0]).toBe('https://switch.example.com/devices/providers?includeAggregates=true');
  });

  it('switches a remote desktop between official and provider models', async () => {
    const officialResult = {
      deviceId: 'device/1',
      activeAccountId: 'account-2',
      activeProviderId: null,
      requiresRestart: true,
      online: true,
    };
    const providerResult = {
      deviceId: 'device/1',
      activeAccountId: 'account-2',
      activeProviderId: 'provider-1',
      requiresRestart: true,
      online: true,
    };
    const groupResult = {
      ...providerResult,
      activeProviderId: null,
      activeProviderGroup: '工作',
    };
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(officialResult), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(providerResult), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(groupResult), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(switchRemoteDeviceAccount(session, 'device/1', 'account-2'))
      .resolves.toEqual(officialResult);
    await expect(switchRemoteDeviceProvider(session, 'device/1', 'provider-1'))
      .resolves.toEqual(providerResult);
    await expect(switchRemoteDeviceProviderGroup(session, 'device/1', '工作'))
      .resolves.toEqual(groupResult);
    expect(apiFetch.mock.calls.map((call) => call[0])).toEqual([
      'https://switch.example.com/devices/device%2F1/account',
      'https://switch.example.com/devices/device%2F1/provider',
      'https://switch.example.com/devices/device%2F1/provider-group',
    ]);
    expect(JSON.parse((apiFetch.mock.calls[0]?.[1] as RequestInit).body as string))
      .toEqual({ accountId: 'account-2' });
    expect(JSON.parse((apiFetch.mock.calls[1]?.[1] as RequestInit).body as string))
      .toEqual({ providerId: 'provider-1' });
    expect(JSON.parse((apiFetch.mock.calls[2]?.[1] as RequestInit).body as string))
      .toEqual({ group: '工作' });
  });

  it('sends GUI selections to their own device endpoints', async () => {
    const result = { deviceId: 'device/1', guiAccountId: null, guiProviderId: 'provider-1',
      requiresRestart: false, online: true };
    const apiFetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(result), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);
    await switchRemoteDeviceAccount(session, 'device/1', 'account-2', 'gui');
    await expect(switchRemoteDeviceProvider(session, 'device/1', 'provider-1', 'gui')).resolves.toEqual(result);
    expect(apiFetch.mock.calls.map(call => call[0])).toEqual([
      'https://switch.example.com/devices/device%2F1/gui-account',
      'https://switch.example.com/devices/device%2F1/gui-provider',
    ]);
    expect(apiFetch.mock.calls.map(call => JSON.parse(call[1].body))).toEqual([
      { accountId: 'account-2' }, { providerId: 'provider-1' },
    ]);
  });

  it('switches aggregate choices without sending them as plain providers', async () => {
    const apiFetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ online: true }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);
    await switchRemoteDeviceProvider(session, 'device/1', 'aggregate:route', 'gui');
    await switchRemoteDeviceProvider(session, 'device/1', 'aggregate:route', 'proxy');
    expect(apiFetch.mock.calls.map(call => call[0])).toEqual([
      'https://switch.example.com/devices/device%2F1/gui-aggregate',
      'https://switch.example.com/devices/device%2F1/aggregate',
    ]);
    expect(apiFetch.mock.calls.map(call => JSON.parse(call[1].body))).toEqual([
      { aggregateId: 'route' }, { aggregateId: 'route' },
    ]);
  });

  it('restarts Codex on the selected remote desktop', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ restarted: true }), {
      status: 200,
    }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(restartRemoteDeviceCodex(session, 'device/1')).resolves.toBeUndefined();
    expect(apiFetch.mock.calls[0]?.[0]).toBe(
      'https://switch.example.com/devices/device%2F1/restart-codex',
    );
    expect(apiFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
  });

  it('synchronizes the mobile 2FA vault only when explicitly requested', async () => {
    const vault: TotpVault = {
      entries: [],
      tombstones: [{
        id: '10000000-0000-4000-8000-000000000001',
        deletedAt: '2026-08-15T10:00:00.000Z',
      }],
      modifiedAt: '2026-08-15T10:00:00.000Z',
    };
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(vault), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(syncTotpVault(session, vault)).resolves.toEqual(vault);

    expect(apiFetch.mock.calls[0]?.[0]).toBe('https://switch.example.com/sync/totp');
    const request = apiFetch.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe('PUT');
    expect(JSON.parse(request.body as string)).toEqual(vault);
  });

  it('downloads the cloud 2FA vault without uploading the local vault', async () => {
    const vault: TotpVault = {
      entries: [],
      tombstones: [{
        id: '10000000-0000-4000-8000-000000000001',
        deletedAt: '2026-08-15T10:00:00.000Z',
      }],
      modifiedAt: '2026-08-15T10:00:00.000Z',
    };
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(vault), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(fetchTotpVault(session)).resolves.toEqual(vault);

    expect(apiFetch.mock.calls[0]?.[0]).toBe('https://switch.example.com/sync/totp');
    expect((apiFetch.mock.calls[0]?.[1] as RequestInit).method).toBeUndefined();
  });

  it('starts mobile OAuth, polls it, and updates editable account details', async () => {
    const oauth = {
      sessionId: 'oauth-session',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-EFGH',
      interval: 2,
      expiresIn: 900,
    };
    const details = {
      note: 'Mobile note',
      expiresAt: '2026-12-31',
      privateDetails: {
        password: 'account-password',
        phoneNumber: '+65 6123 4567',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      },
    };
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(oauth), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(account(details)), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(startAccountOAuth(session)).resolves.toEqual(oauth);
    await expect(pollAccountOAuth(session, 'oauth/session')).resolves.toEqual({ status: 'pending' });
    await expect(updateAccountDetails(session, 'account/1', details))
      .resolves.toEqual(expect.objectContaining(details));

    expect(apiFetch.mock.calls[0]?.[0]).toBe(
      'https://switch.example.com/sync/accounts/oauth/start',
    );
    expect(apiFetch.mock.calls[1]?.[0]).toBe(
      'https://switch.example.com/sync/accounts/oauth/oauth%2Fsession/poll',
    );
    expect(apiFetch.mock.calls[2]?.[0]).toBe(
      'https://switch.example.com/sync/accounts/account%2F1/details',
    );
    expect(JSON.parse((apiFetch.mock.calls[2]?.[1] as RequestInit).body as string)).toEqual(details);
  });

  it('completes an embedded OAuth callback inside the mobile app', async () => {
    const oauth = {
      sessionId: 'embedded-session',
      authorizationUrl: 'https://auth.openai.com/oauth/authorize?state=oauth-state',
      callbackUrl: 'http://localhost:1455/auth/callback',
      expiresIn: 600,
    };
    const callback = { code: 'authorization-code', state: 'oauth-state' };
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(oauth), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', account: account() }), {
        status: 200,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(startEmbeddedAccountOAuth(session)).resolves.toEqual(oauth);
    await expect(completeEmbeddedAccountOAuth(session, 'embedded/session', callback))
      .resolves.toEqual(expect.objectContaining({ status: 'complete' }));
    await expect(pollEmbeddedAccountOAuth(session, 'embedded/session'))
      .resolves.toEqual({ status: 'pending' });

    expect(apiFetch.mock.calls[0]?.[0]).toBe(
      'https://switch.example.com/sync/accounts/oauth/embedded/start',
    );
    expect(apiFetch.mock.calls[1]?.[0]).toBe(
      'https://switch.example.com/sync/accounts/oauth/embedded/embedded%2Fsession/complete',
    );
    expect(JSON.parse((apiFetch.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual(callback);
    expect(apiFetch.mock.calls[2]?.[0]).toBe(
      'https://switch.example.com/sync/accounts/oauth/embedded/embedded%2Fsession/poll',
    );
  });
});
