import { contextUsage, formatContextTokens } from '../context-usage/values';
import type { ThreadTokenUsage } from './client/types';
import type { SettingField, SettingOption } from './settingsMenu';
import type { UsageSummary } from './usage';

export const SETTING_SHORT_LABELS = {
  model: 'client.shared.model',
  effort: 'client.chatSettings.effort',
  speed: 'client.chatSettings.speed',
  access: 'client.chatSettings.access',
} as const;

const SPEED_SHORT_LABELS: Record<string, string> = {
  normal: 'client.chatSettings.normal', fast: 'client.chatSettings.fast', ultrafast: 'client.chatSettings.ultrafast',
};

/** Short visual labels retain the full accessible names and original option values. */
export function settingShortLabel(field: SettingField, option: SettingOption) {
  return field === 'speed' ? SPEED_SHORT_LABELS[option.value] ?? option.label : option.label;
}

export function settingsContextAmounts(usage: ThreadTokenUsage | undefined, locale: string) {
  const context = contextUsage(usage);
  const used = context ? formatContextTokens(context.used, locale) : '—';
  const capacity = context?.capacity == null ? '—' : formatContextTokens(context.capacity, locale);
  return `${used} / ${capacity} Token`;
}

function formatAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 });
}

export function settingsQuotaAmounts(quota: UsageSummary['estimatedQuota']) {
  return `${formatAmount(quota?.remainingUsd)} / ${formatAmount(quota?.capacityUsd)} USD`;
}

export function settingsCost(value: number | null | undefined) {
  return `${formatAmount(value)} USD`;
}
