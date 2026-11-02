use crate::models::{UsageSummary, UsageWindow};

pub(super) const WINDOW_MINUTES: i64 = 300;
pub(super) const WINDOW_SECONDS: i64 = WINDOW_MINUTES * 60;
pub(super) const CONFIRMATION_SECONDS: u64 = 3;
const RESET_CLOCK_TOLERANCE_SECONDS: i64 = 30;
const RESET_DRIFT_TOLERANCE_SECONDS: i64 = 1;

fn five_hour_window(usage: &UsageSummary) -> Option<&UsageWindow> {
    [&usage.primary, &usage.secondary]
        .into_iter()
        .flatten()
        .find(|window| window.window_minutes == Some(WINDOW_MINUTES))
}

/// A single future reset is ambiguous: idle accounts can report `now + five hours`.
pub(super) fn can_start_window(usage: &UsageSummary, now: i64) -> bool {
    idle_quota(usage)
        && five_hour_window(usage)
            .is_some_and(|window| window.resets_at.is_none_or(|reset| reset <= now))
}

fn idle_quota(usage: &UsageSummary) -> bool {
    if usage.error.is_some() {
        return false;
    }
    let Some(at) = fetched_at(usage) else {
        return false;
    };
    let Some(window) = five_hour_window(usage) else {
        return false;
    };
    let idle = window.used_percent == 0.0 && window.remaining_percent == 100.0;
    idle && [&usage.primary, &usage.secondary]
        .into_iter()
        .flatten()
        .all(|other| {
            other.remaining_percent.is_finite()
                && (other.remaining_percent > 0.0
                    || other.resets_at.is_some_and(|reset| reset <= at))
        })
}

fn reset_observation(usage: &UsageSummary) -> Option<(i64, i64)> {
    five_hour_window(usage)?.resets_at.zip(fetched_at(usage))
}

fn fetched_at(usage: &UsageSummary) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(usage.fetched_at.as_deref()?)
        .ok()
        .map(|at| at.timestamp())
}

/// Probe only full windows whose deadline could be the service's idle placeholder.
pub(super) fn needs_idle_confirmation(usage: &UsageSummary) -> bool {
    idle_quota(usage) && full_length_deadline(usage)
}

fn full_length_deadline(usage: &UsageSummary) -> bool {
    if usage.error.is_some()
        || !five_hour_window(usage)
            .is_some_and(|window| window.used_percent == 0.0 && window.remaining_percent == 100.0)
    {
        return false;
    }
    let Some((reset, at)) = reset_observation(usage) else {
        return false;
    };
    reset
        .checked_sub(at)
        .and_then(|left| left.checked_sub(WINDOW_SECONDS))
        .is_some_and(|offset| offset.unsigned_abs() <= RESET_CLOCK_TOLERANCE_SECONDS as u64)
}

/// Authorize only if two fresh zero-usage reads show the deadline advancing with time.
/// A rounded-zero running window keeps a fixed deadline and must never pass this check.
pub(super) fn sliding_idle_confirmed(previous: &UsageSummary, current: &UsageSummary) -> bool {
    if !needs_idle_confirmation(previous) || !needs_idle_confirmation(current) {
        return false;
    }
    let Some(((new_reset, new_at), (old_reset, old_at))) =
        reset_observation(current).zip(reset_observation(previous))
    else {
        return false;
    };
    let Some((elapsed, drift)) = new_at
        .checked_sub(old_at)
        .zip(new_reset.checked_sub(old_reset))
    else {
        return false;
    };
    elapsed >= CONFIRMATION_SECONDS as i64
        && drift > RESET_DRIFT_TOLERANCE_SECONDS
        && (drift - elapsed).abs() <= RESET_DRIFT_TOLERANCE_SECONDS
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
    if window.used_percent > 0.0 {
        return five_hour_window(previous).is_none_or(|old| {
            old.resets_at != window.resets_at || window.used_percent > old.used_percent
        });
    }
    // Merely refreshing an unused account can move reset_at; it is not account activity.
    if full_length_deadline(current) {
        return full_length_deadline(previous)
            && five_hour_window(previous).is_some_and(|old| old.resets_at == window.resets_at)
            && fetched_at(current)
                .zip(fetched_at(previous))
                .is_some_and(|(new, old)| new - old >= CONFIRMATION_SECONDS as i64);
    }
    five_hour_window(previous).is_none_or(|old| old.resets_at != window.resets_at)
}
