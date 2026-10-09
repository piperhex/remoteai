export interface UsageSummary {
  totalTokens: number;
  estimatedCostUsd: number;
  primaryRemainingPercent: number | null;
  primaryRemainingAggregated: boolean;
  providerEstimatedCost: { amountUsd: number; aggregated: boolean } | null;
}

export type ReadUsage = () => Promise<UsageSummary>;
export const USAGE_REFRESH_INTERVAL_MS = 5_000;
const MILLION = 1_000_000;
const THOUSAND = 1_000;
const LOW_QUOTA_PERCENT = 20;
const WARNING_QUOTA_PERCENT = 50;
const THREAD_TOKEN_FRACTION_DIGITS = 2;

export function formatThreadTokens(value?: number) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
  const divisor = value >= MILLION ? MILLION : THOUSAND;
  const unit = value >= MILLION ? 'M' : 'K';
  return `${(value / divisor).toFixed(THREAD_TOKEN_FRACTION_DIGITS)}${unit}`;
}

export function formatTokens(value: number, fractionDigits?: number) {
  const options = {
    minimumFractionDigits: fractionDigits ?? 0,
    maximumFractionDigits: fractionDigits ?? (value >= MILLION ? 2 : 1),
  };
  if (value >= MILLION) return `${(value / MILLION).toLocaleString('en-US', options)}M`;
  if (value >= THOUSAND) return `${(value / THOUSAND).toLocaleString('en-US', options)}K`;
  return value.toLocaleString('en-US');
}

export function formatCost(value: number) {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 })}USD`;
}

export function usageTrailing(usage: UsageSummary | null, translate = (text: string) => text, cost = formatCost) {
  const remaining = usage?.primaryRemainingPercent;
  if (typeof remaining === 'number' && Number.isFinite(remaining)) {
    const label = usage?.primaryRemainingAggregated ? '并发账户剩余额度合计' : '当前账户剩余额度';
    return {
      text: `${Math.round(remaining)}%`,
      label: translate(usage?.primaryRemainingAggregated ? '合计剩余' : '剩余'),
      description: `${translate(label)}：${remaining.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`,
      tone: remaining <= LOW_QUOTA_PERCENT ? 'low' : remaining <= WARNING_QUOTA_PERCENT ? 'cost' : 'quota',
    } as const;
  }
  const estimate = usage?.providerEstimatedCost;
  if (!estimate) return null;
  const label = estimate.aggregated ? '聚合 API 今日预估费用' : '当前 API 今日预估费用';
  return { text: `API ${cost(estimate.amountUsd)}`, label: '',
    description: `${translate(label)}：${cost(estimate.amountUsd)}`, tone: 'cost' } as const;
}
