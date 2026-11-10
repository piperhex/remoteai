// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../api/backend';
import { DEMO_ACCOUNTS } from '../demo';
import { createGuiSettingsClient, GUI_SETTINGS_OPERATIONS } from '../../../../shared/remote-chat/guiSettings';
import { GUI_TOOL_OPERATIONS } from '../../../../shared/remote-chat/guiTools';
import { guiToolRequest } from './guiTools';

vi.mock('../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: vi.fn() }));

beforeEach(() => { vi.mocked(invoke).mockReset(); });

it('exposes only account display fields and provider identifiers to the remote settings dialog', async () => {
  const account = { ...DEMO_ACCOUNTS[0],
    privateDetails: { password: 'secret', phoneNumber: 'private', totpSecret: 'otp' },
    usage: { ...DEMO_ACCOUNTS[0].usage, error: 'private-path', credits: { balance: 'secret' } } };
  vi.mocked(invoke).mockResolvedValueOnce([account]).mockResolvedValueOnce([
    { id: 'fallback', name: 'Fallback', apiKey: 'secret', baseUrl: 'private-url' },
  ]);
  const result = await guiToolRequest({ operation: 'guiSettingsAccounts' });
  expect(result).toEqual({ accounts: [{ id: account.id, email: account.email, expiresAt: account.expiresAt,
    localProxyCompatible: account.localProxyCompatible, usage: { primary: account.usage.primary ?? null,
      secondary: account.usage.secondary ?? null, apiExpiresAt: account.usage.apiExpiresAt } }],
    providers: [{ id: 'fallback', name: 'Fallback' }] });
  expect(JSON.stringify(result)).not.toMatch(/secret|private|otp/);
});

it('routes every settings request through the selected authenticated connection and fixed host commands', async () => {
  const request = vi.fn(async (body: object) => guiToolRequest(body as Record<string, unknown>));
  const client = createGuiSettingsClient(request as <T>(body: object) => Promise<T>);
  const autoSwitch = { enabled: true, switchOnQuotaExhaustion: true, minimumRemainingPercent: 5,
    mode: 'sequential' as const, fallbackProviderId: 'fallback', accounts: [] };
  const prompts = { filterEnabled: false, filterRules: [], injectionEnabled: true,
    injectionPrompts: [{ name: 'Remote rule', text: 'Use remote settings', enabled: true }] };
  vi.mocked(invoke).mockResolvedValue({});
  await client.autoSwitch.read(); await client.autoSwitch.write(autoSwitch);
  await client.context.read(); await client.context.write('remote-model', 256_000);
  await client.context.write('remote-model', null);
  await client.systemPrompts.read(); await client.systemPrompts.write(prompts);
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ['codex_gui_auto_switch_settings'], ['codex_gui_set_auto_switch_settings', { settings: autoSwitch }],
    ['codex_gui_model_context_settings'], ['codex_gui_set_model_context', { model: 'remote-model', capacity: 256_000 }],
    ['codex_gui_set_model_context', { model: 'remote-model', capacity: null }],
    ['codex_gui_system_prompt_settings'], ['codex_gui_set_system_prompt_settings', { settings: prompts }],
  ]);
  for (const operation of GUI_SETTINGS_OPERATIONS) expect(GUI_TOOL_OPERATIONS.has(operation)).toBe(true);
});

it('rejects invalid settings without accepting arbitrary command fields', async () => {
  vi.mocked(invoke).mockRejectedValue(new Error('Invalid settings'));
  await expect(guiToolRequest({ operation: 'guiModelContextWrite', command: 'write_file', path: 'private',
    model: '', capacity: -1 })).rejects.toThrow('Invalid settings');
  expect(invoke).toHaveBeenCalledExactlyOnceWith('codex_gui_set_model_context', { model: '', capacity: -1 });
});
