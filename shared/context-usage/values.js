// Shared by the GUI and the script embedded in the ChatGPT renderer.
export const FULL_PERCENT = 100;

export function contextUsage(usage) {
  const used = usage?.last?.totalTokens;
  const total = usage?.modelContextWindow;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return null;
  const capacity = typeof total === "number" && Number.isFinite(total) && total > 0 ? total : null;
  const percent = capacity === null ? null : Math.min(FULL_PERCENT, Math.round(used / capacity * FULL_PERCENT));
  return { used, capacity, percent };
}

export function formatContextTokens(value, locale) {
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000)}K`;
  }
  return new Intl.NumberFormat(locale).format(value);
}
