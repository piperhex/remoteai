use crate::{
    codex_gui::{
        account_selection::{self, GuiAccountSelection, SelectionSnapshot},
        auto_switch_policy::{self as policy, Candidate, GuiAccountScheduler},
        auto_switch_settings::{self as settings, GuiAutoSwitchMode, SettingsSnapshot},
    },
    models::{AccountSummary, UsageSummary},
};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, Runtime};

const QUOTA_FRESHNESS_SECONDS: i64 = 30;
const EXHAUSTED_COOLDOWN: Duration = Duration::from_secs(30);
static ROUTING: OnceLock<Mutex<HashMap<PathBuf, RoutingState>>> = OnceLock::new();

#[derive(Debug, thiserror::Error)]
pub(super) enum AutoSwitchError {
    #[error("暂时无法读取自动切号设置，请稍后重试。")]
    Storage,
    #[error("暂无符合条件的账号，请调整自动切号设置或选择其他账户。")]
    NoAccount,
    #[error("账户设置已更新。")]
    Changed,
}

#[derive(Clone)]
pub(super) struct Route {
    pub(super) selection: GuiAccountSelection,
    seed: SelectionSnapshot,
    config: SettingsSnapshot,
    attempt_started_at: Instant,
}

impl Route {
    pub(super) fn begin_attempt(&mut self) {
        self.attempt_started_at = Instant::now();
    }
}

#[derive(Default)]
struct RoutingState {
    selection_revision: u64,
    scheduler: GuiAccountScheduler,
    exhausted: HashMap<String, Exhaustion>,
    recovered: HashMap<String, Instant>,
}

struct Exhaustion {
    observed_at: Instant,
    next_check_at: Instant,
}

fn with_routing<R: Runtime, T>(
    app: &AppHandle<R>,
    route: &Route,
    apply: impl FnOnce(&mut RoutingState) -> T,
) -> Result<T, AutoSwitchError> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| AutoSwitchError::Storage)?;
    let mut states = ROUTING
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| AutoSwitchError::Storage)?;
    let state = states.entry(root).or_default();
    if state.selection_revision > route.seed.revision {
        return Err(AutoSwitchError::Changed);
    }
    if state.selection_revision != route.seed.revision {
        state.selection_revision = route.seed.revision;
        state.scheduler = GuiAccountScheduler::default();
    }
    Ok(apply(state))
}

fn initial<R: Runtime>(app: &AppHandle<R>) -> Result<Route, AutoSwitchError> {
    let seed = account_selection::snapshot(app).map_err(|_| AutoSwitchError::Storage)?;
    let config = settings::snapshot(app).map_err(|_| AutoSwitchError::Storage)?;
    Ok(Route {
        selection: seed.selection.clone(),
        seed,
        config,
        attempt_started_at: Instant::now(),
    })
}

/// Only request workers inspect quota data. Settings, account picking and polling never wait
/// for these network refreshes; their revisions are checked after the refresh has finished.
pub(super) fn prepare<R: Runtime>(
    app: &AppHandle<R>,
    session: Option<&str>,
) -> Result<Route, AutoSwitchError> {
    let route = initial(app)?;
    if !route.config.settings.enabled
        || matches!(
            route.selection,
            GuiAccountSelection::Provider(_) | GuiAccountSelection::Aggregate(_)
        )
    {
        return Ok(route);
    }
    match choose(
        app,
        route,
        ChoiceRequest {
            session,
            failed: &HashSet::new(),
        },
    ) {
        Err(AutoSwitchError::Changed) => initial(app),
        result => result,
    }
}

struct ChoiceRequest<'a> {
    session: Option<&'a str>,
    failed: &'a HashSet<String>,
}

fn quota_needs_refresh(usage: &UsageSummary) -> bool {
    usage.error.is_some()
        || usage
            .fetched_at
            .as_deref()
            .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
            .is_none_or(|time| {
                let age = chrono::Utc::now().signed_duration_since(time).num_seconds();
                !(0..QUOTA_FRESHNESS_SECONDS).contains(&age)
            })
}

fn refresh_account<R: Runtime>(app: &AppHandle<R>, account: &mut AccountSummary) {
    if !quota_needs_refresh(&account.usage) {
        return;
    }
    // The strict refresh updates credential/quota facts, without the shared auto-disable rules.
    match crate::commands::try_refresh_usage_blocking(app, &account.id) {
        Ok(usage) => account.usage = usage,
        Err(_) => account.usage.error = Some("暂时无法刷新额度。".into()),
    }
}

fn choose<R: Runtime>(
    app: &AppHandle<R>,
    route: Route,
    request: ChoiceRequest<'_>,
) -> Result<Route, AutoSwitchError> {
    let mut accounts = crate::commands::list_accounts_blocking(app.clone())
        .map_err(|_| AutoSwitchError::Storage)?;
    recover_exhausted(app, &route, &mut accounts)?;
    let mut excluded = with_routing(app, &route, |state| {
        state.exhausted.keys().cloned().collect::<HashSet<_>>()
    })?;
    excluded.extend(request.failed.iter().cloned());
    if keep_current(app, &route, &mut accounts, &excluded) {
        ensure_current(app, &route)?;
        return Ok(route);
    }
    for account in accounts.iter_mut().filter(|account| {
        account.local_proxy_compatible
            && !excluded.contains(&account.id)
            && route
                .config
                .settings
                .account_rule(&account.id)
                .is_none_or(|rule| rule.enabled)
    }) {
        refresh_account(app, account);
    }
    let candidates = policy::candidates(&accounts, &route.config.settings, &excluded);
    let fallback = fallback(app, &route, candidates.is_empty())?;
    commit(
        app,
        route,
        CandidateSelection {
            candidates: &candidates,
            session: request.session,
            fallback,
        },
    )
}

fn ensure_current<R: Runtime>(app: &AppHandle<R>, route: &Route) -> Result<(), AutoSwitchError> {
    settings::with_current(app, route.config.revision, || {
        account_selection::with_current(app, route.seed.revision, || ())
            .map_err(|_| AutoSwitchError::Storage)?
            .ok_or(AutoSwitchError::Changed)
    })
    .map_err(|_| AutoSwitchError::Storage)?
    .ok_or(AutoSwitchError::Changed)?
}

fn recover_exhausted<R: Runtime>(
    app: &AppHandle<R>,
    route: &Route,
    accounts: &mut [AccountSummary],
) -> Result<(), AutoSwitchError> {
    let probes = with_routing(app, route, |state| {
        state
            .exhausted
            .retain(|id, _| accounts.iter().any(|account| account.id == *id));
        state
            .exhausted
            .iter_mut()
            .filter_map(|(id, failure)| {
                if Instant::now() < failure.next_check_at {
                    return None;
                }
                failure.next_check_at = Instant::now() + EXHAUSTED_COOLDOWN;
                Some((id.clone(), failure.observed_at))
            })
            .collect::<Vec<_>>()
    })?;
    for (id, observed) in probes {
        let Some(account) = accounts.iter_mut().find(|account| account.id == id) else {
            continue;
        };
        let refresh_started_at = Instant::now();
        let Ok(usage) = crate::commands::try_refresh_usage_blocking(app, &id) else {
            continue;
        };
        account.usage = usage;
        if policy::candidates(
            std::slice::from_ref(account),
            &route.config.settings,
            &HashSet::new(),
        )
        .is_empty()
        {
            continue;
        }
        with_routing(app, route, |state| {
            if state
                .exhausted
                .get(&id)
                .is_some_and(|failure| failure.observed_at == observed)
            {
                state.exhausted.remove(&id);
                state.recovered.insert(id.clone(), refresh_started_at);
            }
        })?;
    }
    Ok(())
}

fn keep_current<R: Runtime>(
    app: &AppHandle<R>,
    route: &Route,
    accounts: &mut [AccountSummary],
    excluded: &HashSet<String>,
) -> bool {
    if route.config.settings.mode == GuiAutoSwitchMode::Concurrent {
        return false;
    }
    let GuiAccountSelection::Account(id) = &route.selection else {
        return false;
    };
    if excluded.contains(id) {
        return false;
    }
    let current = accounts.iter_mut().find(|account| account.id == *id);
    if let Some(account) = current {
        refresh_account(app, account);
        return !policy::current_requires_switch(Some(account), &route.config.settings);
    }
    false
}

fn fallback<R: Runtime>(
    app: &AppHandle<R>,
    route: &Route,
    needed: bool,
) -> Result<Option<GuiAccountSelection>, AutoSwitchError> {
    if !needed {
        return Ok(None);
    }
    let Some(id) = &route.config.settings.fallback_provider_id else {
        return Err(AutoSwitchError::NoAccount);
    };
    let paths = crate::storage::resolve_paths(app).map_err(|_| AutoSwitchError::Storage)?;
    let provider =
        crate::providers::read_provider(&paths, id).map_err(|_| AutoSwitchError::NoAccount)?;
    crate::providers::ensure_not_local_proxy_base_url(&provider.base_url)
        .map_err(|_| AutoSwitchError::NoAccount)?;
    Ok(Some(GuiAccountSelection::Provider(id.clone())))
}

struct CandidateSelection<'a> {
    candidates: &'a [Candidate],
    session: Option<&'a str>,
    fallback: Option<GuiAccountSelection>,
}

fn commit<R: Runtime>(
    app: &AppHandle<R>,
    mut route: Route,
    choice: CandidateSelection<'_>,
) -> Result<Route, AutoSwitchError> {
    let applied = settings::with_current(app, route.config.revision, || {
        if route.config.settings.mode == GuiAutoSwitchMode::Concurrent {
            commit_concurrent(app, &route, choice)
        } else {
            let selection = choice
                .candidates
                .first()
                .map(|candidate| GuiAccountSelection::Account(candidate.id.clone()))
                .or(choice.fallback)
                .ok_or(AutoSwitchError::NoAccount)?;
            let seed = account_selection::compare_and_switch(app, route.seed.revision, &selection)
                .map_err(|_| AutoSwitchError::Storage)?
                .ok_or(AutoSwitchError::Changed)?;
            Ok((selection, seed))
        }
    })
    .map_err(|_| AutoSwitchError::Storage)?
    .ok_or(AutoSwitchError::Changed)??;
    route.selection = applied.0;
    route.seed = applied.1;
    Ok(route)
}

fn commit_concurrent<R: Runtime>(
    app: &AppHandle<R>,
    route: &Route,
    choice: CandidateSelection<'_>,
) -> Result<(GuiAccountSelection, SelectionSnapshot), AutoSwitchError> {
    account_selection::with_current(app, route.seed.revision, || {
        let id = with_routing(app, route, |state| {
            state
                .scheduler
                .assign(choice.session, choice.candidates, Instant::now())
        })?;
        let selected = id
            .map(GuiAccountSelection::Account)
            .or(choice.fallback)
            .ok_or(AutoSwitchError::NoAccount)?;
        Ok((selected, route.seed.clone()))
    })
    .map_err(|_| AutoSwitchError::Storage)?
    .ok_or(AutoSwitchError::Changed)?
}

pub(super) fn after_quota<R: Runtime>(
    app: &AppHandle<R>,
    route: &Route,
    session: Option<&str>,
    failed: &HashSet<String>,
) -> Result<Option<Route>, AutoSwitchError> {
    after_failure(app, route, ChoiceRequest { session, failed }, true)
}

pub(super) fn after_authentication_failure<R: Runtime>(
    app: &AppHandle<R>,
    route: &Route,
    session: Option<&str>,
    failed: &HashSet<String>,
) -> Result<Option<Route>, AutoSwitchError> {
    after_failure(app, route, ChoiceRequest { session, failed }, false)
}

fn after_failure<R: Runtime>(
    app: &AppHandle<R>,
    route: &Route,
    request: ChoiceRequest<'_>,
    quota_exhausted: bool,
) -> Result<Option<Route>, AutoSwitchError> {
    let latest = initial(app)?;
    if !latest.config.settings.enabled
        || (quota_exhausted && !latest.config.settings.switch_on_quota_exhaustion)
        || latest.config.revision != route.config.revision
        || !matches!(route.selection, GuiAccountSelection::Account(_))
    {
        return Ok(None);
    }
    if latest.seed.revision != route.seed.revision {
        let reusable = match &latest.selection {
            GuiAccountSelection::Account(id) => !request.failed.contains(id),
            GuiAccountSelection::Provider(_) | GuiAccountSelection::Aggregate(_) => true,
            GuiAccountSelection::None => false,
        };
        return Ok((reusable && latest.selection != route.selection).then_some(latest));
    }
    if !remember_exhaustion(app, route)? {
        return Ok(None);
    }
    match choose(app, route.clone(), request) {
        Ok(next) if next.selection != route.selection => Ok(Some(next)),
        Ok(_) | Err(AutoSwitchError::Changed | AutoSwitchError::NoAccount) => Ok(None),
        Err(error) => Err(error),
    }
}

fn remember_exhaustion<R: Runtime>(
    app: &AppHandle<R>,
    route: &Route,
) -> Result<bool, AutoSwitchError> {
    let GuiAccountSelection::Account(id) = &route.selection else {
        return Ok(false);
    };
    with_routing(app, route, |state| {
        // Check recovery and record this attempt together, without replaying prior retry failures.
        if state
            .recovered
            .get(id)
            .is_some_and(|recovered| *recovered > route.attempt_started_at)
        {
            return false;
        }
        let observed_at = Instant::now();
        state.exhausted.insert(
            id.clone(),
            Exhaustion {
                observed_at,
                next_check_at: observed_at + EXHAUSTED_COOLDOWN,
            },
        );
        state.scheduler.invalidate_account(id);
        true
    })
}

#[cfg(test)]
#[path = "gui_auto_switch_tests.rs"]
mod tests;
