import { displayText } from '../../../../../shared/localization/uiText';
import { RequestSpeedButton } from "../../../../../shared/remote-chat/RequestSpeedButton";
import type { RequestSpeed } from "../../../../../shared/remote-chat/composer";

import type { Translate } from "../../i18n";
import type { LocalProxyStatus, ProxyServiceTier } from "../../types";

const SPEEDS: Record<ProxyServiceTier, RequestSpeed> = {
  default: "normal", priority: "fast", ultrafast: "ultrafast",
};
const SERVICE_TIERS: Record<RequestSpeed, ProxyServiceTier> = {
  normal: "default", fast: "priority", ultrafast: "ultrafast",
};

export function ExternalProxySpeedButton({ proxy, busy, onChange, t }: {
  proxy: LocalProxyStatus | null;
  busy: boolean;
  onChange: (tier: ProxyServiceTier) => void;
  t: Translate;
}) {
  const tier = proxy?.serviceTier ?? (proxy?.fastModeEnabled ? "priority" : "default");
  return <RequestSpeedButton speed={SPEEDS[tier]} disabled={!proxy?.running} busy={busy}
    error={!proxy?.running ? t("usage.speedProxyRequired") : undefined}
    available={Boolean(proxy?.fastModeAvailable)} translate={displayText}
    onChange={(speed) => onChange(SERVICE_TIERS[speed])} />;
}
