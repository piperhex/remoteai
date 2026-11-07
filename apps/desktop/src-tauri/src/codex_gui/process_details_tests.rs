use super::*;

fn history() -> Value {
    let mut items = vec![json!({"id":"question", "type":"userMessage"})];
    items.extend((0..2_000).map(|index| {
        json!({"id":format!("work-{index}"),
        "type":"agentMessage", "phase":"commentary", "text":"private details ".repeat(50)})
    }));
    items
        .push(json!({"id":"answer", "type":"agentMessage", "phase":"final_answer", "text":"done"}));
    json!({"thread":{"id":"chat", "turns":[{"id":"turn", "status":"completed", "items":items}]}})
}

#[test]
fn entire_folded_process_is_one_bounded_history_item() {
    let mut data = history();
    let window = serde_json::from_value(json!({"deferProcesses":true})).unwrap();
    super::super::history_page::apply(&mut data, &window).unwrap();
    let items = data["thread"]["turns"][0]["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(items[1]["activityCount"], 2_000);
    assert_eq!(items[1]["processRef"]["endItemId"], "work-1999");
    assert_eq!(data["page"]["hasMore"], false);
    assert!(data.to_string().len() < 1_000);
    assert!(!data.to_string().contains("private details"));
}

#[test]
fn expands_every_activity_but_rejects_cross_turn_and_message_ranges() {
    let source = history();
    let mut target: Target = serde_json::from_value(json!({"threadId":"chat", "turnId":"turn",
        "itemId":"work-0", "endItemId":"work-1999"}))
    .unwrap();
    let items = take_items(&mut source.clone(), &target).unwrap();
    assert_eq!(items.as_array().unwrap().len(), 2_000);
    assert_eq!(items[1999]["id"], "work-1999");
    target.end_item_id = "answer".into();
    assert!(take_items(&mut source.clone(), &target).is_err());
    target.turn_id = "other".into();
    assert!(take_items(&mut source.clone(), &target).is_err());
}

#[test]
fn keeps_live_work_and_splits_completed_processes_at_error_notices() {
    let mut source = history();
    source["thread"]["turns"][0]["status"] = json!("inProgress");
    let mut live = source.clone();
    summarize_thread(&mut live["thread"]);
    assert_eq!(live, source);
    source["thread"]["turns"][0]["status"] = json!("completed");
    source["thread"]["turns"][0]["requestErrors"] = json!([{
        "id":"error", "afterItemId":"work-49", "itemCount":51, "willRetry":true}]);
    summarize_thread(&mut source["thread"]);
    let turn = &source["thread"]["turns"][0];
    assert_eq!(turn["items"].as_array().unwrap().len(), 4);
    assert_eq!(turn["items"][1]["activityCount"], 50);
    assert_eq!(turn["items"][2]["activityCount"], 1_950);
    assert_eq!(turn["requestErrors"][0]["afterItemId"], "work-0");
}

#[test]
fn expanding_a_process_only_loads_summaries_of_nested_commands() {
    let mut data = json!({"thread":{"id":"chat", "turns":[{"id":"turn", "items":[
        {"id":"cmd", "type":"commandExecution", "status":"completed", "exitCode":0,
         "command":"echo private command".repeat(1_000), "aggregatedOutput":"private output".repeat(100_000)},
        {"id":"tool", "type":"mcpToolCall", "tool":"exec", "arguments":{"code":"private code"},
         "result":{"content":[{"text":"private tool output"}]}}
    ]}]}});
    let target = serde_json::from_value(json!({"threadId":"chat", "turnId":"turn",
        "itemId":"cmd", "endItemId":"tool"}))
    .unwrap();
    let items = prepare_items(&mut data, &target).unwrap();
    assert_eq!(items.as_array().unwrap().len(), 2);
    assert_eq!(items[0]["detailsRef"]["itemId"], "cmd");
    assert!(items[0]["command"].is_null());
    assert!(items[0]["aggregatedOutput"].is_null());
    assert!(items[1]["arguments"].is_null());
    assert!(items[1]["result"].is_null());
    let preview = items[0]["commandPreview"].as_str().unwrap();
    assert_eq!(preview.chars().count(), 1_024);
    assert!(preview.ends_with('…'));
    assert!(items.to_string().len() < 2_000);
}
