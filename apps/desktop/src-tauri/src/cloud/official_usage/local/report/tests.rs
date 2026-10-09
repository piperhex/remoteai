use super::*;

fn point(ts: i64, remaining: f64) -> AccountQuotaPoint {
    AccountQuotaPoint {
        ts,
        primary_remaining_percent: Some(remaining),
        secondary_remaining_percent: None,
        primary_reset_at: Some(9000),
        secondary_reset_at: None,
    }
}

fn fixture() -> DeviceUsage {
    DeviceUsage {
        device_name: "Office".into(),
        accounts: vec![AccountUsage {
            account_id: "official".into(),
            account_label: "Account".into(),
            points: vec![point(100, 80.0), point(110, 80.0), point(200, 60.0)],
            samples: vec![
                UsageSample {
                    ts: 150,
                    tokens: 100,
                    cost_usd: 2.0,
                },
                UsageSample {
                    ts: 150,
                    tokens: 200,
                    cost_usd: 4.0,
                },
            ],
        }],
    }
}

#[test]
fn reports_compact_totals_and_changed_quota_only() {
    let (reports, checkpoint) = prepare_report(fixture(), ReportCheckpoint::default(), 0).unwrap();
    assert_eq!(reports.len(), 2);
    let minute = &reports[0].accounts[0].minutes[0];
    assert_eq!(minute.ts, 120);
    assert_eq!(minute.samples, vec![(30, 300, 6.0)]);
    assert_eq!(reports[1].accounts[0].quotas.len(), 2);
    let payload = serde_json::to_string(&reports).unwrap();
    assert!(!payload.contains("first"));
    let (unchanged, _) = prepare_report(fixture(), checkpoint, 0).unwrap();
    assert!(unchanged.is_empty());
}

#[test]
fn upgraded_statistics_exclude_history_and_keep_the_first_new_observation() {
    let mut snapshot = fixture();
    snapshot.accounts[0].points = vec![
        point(100, 80.0),
        point(120, 80.0),
        point(140, 80.0),
        point(200, 60.0),
    ];
    snapshot.accounts[0].samples.push(UsageSample {
        ts: 119,
        tokens: 999,
        cost_usd: 99.0,
    });
    let (reports, checkpoint) =
        prepare_report(snapshot.clone(), ReportCheckpoint::default(), 120).unwrap();
    assert!(reports
        .iter()
        .all(|report| report.version == REPORT_VERSION));
    assert_eq!(
        reports[0].accounts[0].minutes[0].samples,
        vec![(30, 300, 6.0)]
    );
    let quotas = &reports[1].accounts[0].quotas;
    assert_eq!(
        quotas.iter().map(|point| point.ts).collect::<Vec<_>>(),
        vec![120, 200]
    );
    let (unchanged, _) = prepare_report(snapshot, checkpoint, 120).unwrap();
    assert!(unchanged.is_empty());
}

#[test]
fn late_requests_replace_a_minute_and_unacknowledged_reports_are_repeatable() {
    let (first, checkpoint) = prepare_report(fixture(), ReportCheckpoint::default(), 0).unwrap();
    let (retry, _) = prepare_report(fixture(), ReportCheckpoint::default(), 0).unwrap();
    assert_eq!(
        serde_json::to_value(first).unwrap(),
        serde_json::to_value(retry).unwrap()
    );
    let mut snapshot = fixture();
    snapshot.accounts[0].samples.push(UsageSample {
        ts: 155,
        tokens: 50,
        cost_usd: 1.0,
    });
    let (reports, _) = prepare_report(snapshot, checkpoint, 0).unwrap();
    assert_eq!(reports.len(), 1);
    assert_eq!(
        reports[0].accounts[0].minutes[0].samples,
        vec![(30, 300, 6.0), (35, 50, 1.0)]
    );
    assert!(reports[0].accounts[0].quotas.is_empty());
}

#[test]
fn flat_observations_are_omitted_but_rebounds_and_resets_are_reported() {
    let (_, checkpoint) = prepare_report(fixture(), ReportCheckpoint::default(), 0).unwrap();
    let mut snapshot = fixture();
    let account = &mut snapshot.accounts[0];
    account.points.extend([point(250, 60.0), point(300, 90.0)]);
    let mut reset = point(400, 90.0);
    reset.primary_reset_at = Some(18000);
    account.points.push(reset);
    let (reports, _) = prepare_report(snapshot, checkpoint, 0).unwrap();
    assert_eq!(
        reports[0].accounts[0]
            .quotas
            .iter()
            .map(|p| p.ts)
            .collect::<Vec<_>>(),
        vec![300, 400]
    );
}

#[test]
fn initial_backfill_is_bounded_without_truncating_history() {
    let mut snapshot = fixture();
    snapshot.accounts[0].samples = (0..1201)
        .map(|index| UsageSample {
            ts: index * 60,
            tokens: 1,
            cost_usd: 0.1,
        })
        .collect();
    let (reports, _) = prepare_report(snapshot, ReportCheckpoint::default(), 0).unwrap();
    let sizes: Vec<_> = reports
        .iter()
        .map(|report| report.accounts[0].minutes.len())
        .collect();
    assert_eq!(sizes, vec![500, 500, 201, 0]);
}

#[test]
fn a_corrected_observation_in_the_same_second_is_uploaded() {
    let (_, checkpoint) = prepare_report(fixture(), ReportCheckpoint::default(), 0).unwrap();
    let mut snapshot = fixture();
    snapshot.accounts[0].points[2].primary_remaining_percent = Some(59.0);
    let (reports, _) = prepare_report(snapshot, checkpoint, 0).unwrap();
    assert_eq!(reports[0].accounts[0].quotas.len(), 1);
    assert_eq!(
        reports[0].accounts[0].quotas[0].primary_remaining_percent,
        Some(59.0)
    );
}

#[test]
fn third_party_usage_is_excluded() {
    let identities = vec![AccountIdentity {
        id: "official".into(),
        workspace: None,
        email: "a@test".into(),
    }];
    let mut entry: TokenUsageEntry = serde_json::from_value(serde_json::json!({
        "id": "test", "ts": 1, "provider": "Official Codex", "model": "model", "accountId": "official"
    })).unwrap();
    assert_eq!(match_account(&entry, &identities), Some("official"));
    entry.provider_id = Some("third-party".into());
    assert_eq!(match_account(&entry, &identities), None);
    entry.provider_id = None;
    entry.provider = "Other".into();
    assert_eq!(match_account(&entry, &identities), None);
}
