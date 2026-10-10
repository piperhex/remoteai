/// Read the active composer's context on the renderer; no history or database polling is needed.
fn context_usage_overlay_expression(enabled: bool) -> String {
    let values =
        include_str!("../../../../../shared/context-usage/values.js").replace("export ", "");
    let reader = include_str!("context_usage_reader.js");
    let settings = include_str!("../../../../../shared/context-usage/settings.js").replace("export ", "");
    let change = include_str!("context_settings_change.js");
    let runtime = include_str!("context_settings_runtime.js");
    let adapter = include_str!("context_settings_adapter.js");
    let copy = include_str!("context_settings_copy.js");
    let dialog = include_str!("context_settings_dialog.js");
    let css = json!(include_str!("context_usage_overlay.css")).to_string();
    let overlay = include_str!("context_usage_overlay.js").replace("__CONTEXT_USAGE_CSS__", &css);
    format!(
        "(() => {{ const enabled = {enabled};\n{values}\n{reader}\n{settings}\n\
         {change}\n{runtime}\n{adapter}\n{copy}\n{dialog}\n{overlay}\n}})();"
    )
}
