use super::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn request(tab_ids: Vec<String>, keep_tab_ids: Vec<String>) -> Finish {
    Finish {
        thread_id: "thread".into(),
        tab_ids,
        keep_tab_ids,
    }
}

#[tokio::test]
async fn finishing_only_visits_recorded_tabs_and_reports_partial_failures_for_retry() {
    let (temporary, kept, failed) = (id(), id(), id());
    let visited = Arc::new(Mutex::new(Vec::new()));
    let observations = visited.clone();
    let failure = failed.clone();
    let reply = finish_with(
        request(
            vec![
                temporary.clone(),
                kept.clone(),
                failed.clone(),
                temporary.clone(),
            ],
            vec![kept.clone()],
        ),
        move |id, keep| {
            observations.lock().unwrap().push((id.clone(), keep));
            let fails = id == failure;
            async move {
                if fails {
                    return Err(Error::Unavailable);
                }
                Ok(if keep { Outcome::Kept } else { Outcome::Closed })
            }
        },
    )
    .await
    .unwrap();
    assert_eq!(reply.closed_tab_ids, vec![temporary.clone()]);
    assert_eq!(reply.kept_tab_ids, vec![kept.clone()]);
    assert_eq!(reply.failed_tab_ids, vec![failed.clone()]);
    assert_eq!(
        *visited.lock().unwrap(),
        vec![(temporary, false), (kept, true), (failed.clone(), false)]
    );
    let retry = finish_with(request(reply.failed_tab_ids, vec![]), |_, _| async {
        Ok(Outcome::Closed)
    })
    .await
    .unwrap();
    assert_eq!(retry.closed_tab_ids, vec![failed]);
    assert!(retry.failed_tab_ids.is_empty());
}

#[tokio::test]
async fn invalid_finish_requests_never_reach_native_operations() {
    let tab = id();
    for value in [
        json!({"threadId":"../thread","tabIds":[tab]}),
        json!({"threadId":"thread","tabIds":["main"]}),
        json!({"threadId":"thread","tabIds":[tab],"keepTabIds":[id()]}),
        json!({"threadId":"thread","tabIds":vec![tab.clone(); MAX_TABS + 1]}),
    ] {
        let request = serde_json::from_value(value).unwrap();
        let reply = finish_with(request, |_, _| async {
            panic!("invalid request dispatched")
        })
        .await;
        assert!(matches!(reply, Err(Error::Invalid)));
    }
    assert!(serde_json::from_value::<Finish>(json!({
        "threadId":"thread", "tabIds":[], "allTabs":true,
    }))
    .is_err());
}

#[tokio::test]
async fn empty_finish_requests_are_idempotent_and_do_not_sweep_the_conversation() {
    let request = serde_json::from_value(json!({"threadId":"thread","tabIds":[]})).unwrap();
    let reply = finish_with(request, |_, _| async { panic!("empty request dispatched") })
        .await
        .unwrap();
    assert!(reply.closed_tab_ids.is_empty());
    assert!(reply.kept_tab_ids.is_empty());
    assert!(reply.failed_tab_ids.is_empty());
}
