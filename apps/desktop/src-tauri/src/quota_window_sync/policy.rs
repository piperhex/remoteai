use crate::models::{UsageSummary, UsageWindow};

pub(super) const WINDOW_MINUTES: i64 = 300;
pub(super) const WINDOW_SECONDS: i64 = WINDOW_MINUTES * 60;

fn five_hour_window(usage: &UsageSummary) -> Option<&UsageWindow> {
    [&usage.primary, &usage.secondary]
        .into_iter()
        .flatten()
        .find(|window| window.window_minutes == Some(WINDOW_MINUTES))
}

/// A future reset is evidence of a running window even if usage rounds to zero.
pub(super) fn can_start_window(usage: &UsageSummary, now: i64) -> bool {
    if usage.error.is_some() || usage.fetched_at.is_none() {
        return false;
    }
    let Some(window) = five_hour_window(usage) else {
        return false;
    };
    let idle = window.used_percent == 0.0
        && window.remaining_percent == 100.0
        && window.resets_at.is_none_or(|reset| reset <= now);
    idle && [&usage.primary, &usage.secondary]
        .into_iter()
        .flatten()
        .all(|other| {
            other.remaining_percent.is_finite()
                && (other.remaining_percent > 0.0
                    || other.resets_at.is_some_and(|reset| reset <= now))
        })
}

/// Detect direct-client activity without treating an initial cache load as a new request.
pub(super) fn usage_increased(previous: &UsageSummary, current: &UsageSummary, now: i64) -> bool {
    if previous.fetched_at.is_none() || current.error.is_some() {
        return false;
    }
    let Some(window) = five_hour_window(current) else {
        return false;
    };
    if !window.used_percent.is_finite()
        || window.used_percent < 0.0
        || window.resets_at.is_none_or(|reset| reset <= now)
    {
        return false;
    }
    five_hour_window(previous).is_none_or(|old| {
        old.resets_at != window.resets_at || window.used_percent > old.used_percent
    })
}
