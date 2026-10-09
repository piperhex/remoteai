import { Tooltip } from "antd";
import type { Translate } from "../../i18n";
import styles from "./UsageSpeedPill.module.less";

interface UsageSpeedPillProps {
  fastModeEnabled: boolean;
  fastModeAvailable: boolean;
  proxyRunning: boolean;
  loading: boolean;
  onChange: (enabled: boolean) => void;
  t: Translate;
}

export function UsageSpeedPill({
  fastModeEnabled,
  fastModeAvailable,
  proxyRunning,
  loading,
  onChange,
  t,
}: UsageSpeedPillProps) {
  const selectMode = (enabled: boolean) => {
    if (!proxyRunning || loading || (enabled && !fastModeAvailable) || enabled === fastModeEnabled) return;
    onChange(enabled);
  };
  const tooltip = t(!proxyRunning
    ? "usage.speedProxyRequired"
    : fastModeAvailable ? "usage.speedHint" : "usage.speedUnavailable");

  return <Tooltip title={tooltip} styles={{ root: { maxWidth: 400, pointerEvents: "none" } }}>
    <span className={`${styles.pill}${loading ? ` ${styles.loading}` : ""}`}
      role="group" aria-label={t("usage.speedMode")} onClick={(event) => event.stopPropagation()}>
      <button type="button" className={fastModeEnabled ? undefined : styles.selected}
        aria-pressed={!fastModeEnabled} disabled={!proxyRunning || loading}
        onPointerDown={(event) => event.stopPropagation()} onClick={() => selectMode(false)}>
        {t("usage.speedNormal")}
      </button>
      <button type="button" className={fastModeEnabled ? styles.selected : undefined}
        aria-pressed={fastModeEnabled} disabled={!proxyRunning || loading || !fastModeAvailable}
        onPointerDown={(event) => event.stopPropagation()} onClick={() => selectMode(true)}>
        {t("usage.speedFast")}
      </button>
    </span>
  </Tooltip>;
}
