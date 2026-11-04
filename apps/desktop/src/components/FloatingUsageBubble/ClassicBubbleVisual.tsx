import { useId, type CSSProperties, type ReactNode } from "react";
import { remainingTone } from "../../../../../shared/accounts/format";
import styles from "./ClassicBubbleVisual.module.less";

interface ClassicBubbleVisualProps {
  remaining: number | null;
  weeklyRemaining: number | null;
  weekLabel: string;
  resetLabel: ReactNode;
}

function quotaTone(remaining: number | null) {
  return remaining === null ? "unknown" : remainingTone(remaining);
}

function WeeklyProgress({ remaining }: { remaining: number | null }) {
  const gradientId = useId();
  return (
    <svg className={styles.ring} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop className={styles.ringLight} />
          <stop className={styles.ringShade} offset="1" />
        </linearGradient>
      </defs>
      <circle className={styles.track} cx="50" cy="50" r="47.3" />
      {remaining !== null && remaining > 0 && (
        <circle className={styles.progress} cx="50" cy="50" r="47.3" pathLength="100"
          stroke={`url(#${gradientId})`} strokeDasharray={`${remaining} 100`}
          transform="rotate(-90 50 50)" />
      )}
      <circle className={styles.ringRim} cx="50" cy="50" r="49.7" />
    </svg>
  );
}

export function ClassicBubbleVisual({ remaining, weeklyRemaining, weekLabel, resetLabel }: ClassicBubbleVisualProps) {
  const liquidStyle = { "--liquid-level": `${remaining ?? 0}%` } as CSSProperties;
  return (
    <span className={styles.visual} data-weekly-tone={quotaTone(weeklyRemaining)}>
      <WeeklyProgress remaining={weeklyRemaining} />
      <span className={styles.sphere} data-primary-tone={quotaTone(remaining)}>
        {remaining !== null && remaining > 0 && (
          <span className={styles.liquid} style={liquidStyle} data-full={remaining === 100} aria-hidden="true">
            {remaining < 100 && (
              <svg className={styles.wave} viewBox="0 0 200 12" preserveAspectRatio="none">
                <path d="M0 6 Q25 0 50 6 T100 6 T150 6 T200 6 V12 H0Z" />
                <path className={styles.waterline} d="M0 6 Q25 0 50 6 T100 6 T150 6 T200 6" />
              </svg>
            )}
          </span>
        )}
      </span>
      <span className={styles.weekly}>{weekLabel} {weeklyRemaining === null ? "--" : `${weeklyRemaining}%`}</span>
      <span className={styles.value}>{remaining === null ? "--" : `${remaining}%`}</span>
      <span className={styles.reset}>{resetLabel}</span>
    </span>
  );
}
