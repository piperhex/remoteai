/// Share the existing usage-summary lifecycle, without installing a skin or a local service.
fn speed_selector_overlay_expression(service_tier: &str) -> String {
    let selector =
        CODEX_SPEED_SELECTOR_OVERLAY.replace("__CODEX_SWITCH_SERVICE_TIER__", service_tier);
    let registry = include_str!("native_registry_reader.js");
    let subscription = include_str!("native_usage_subscription.js");
    let identity = include_str!("context_usage_reader.js");
    let metrics =
        include_str!("../../../../../shared/context-usage/metrics.js").replace("export ", "");
    let css = json!(format!(
        "{}\n{}",
        include_str!("usage_statusline.css"),
        include_str!("../../../../../shared/chat/usageFooter.css")
    ))
    .to_string();
    let statusline = include_str!("usage_statusline.js").replace("__USAGE_STATUSLINE_CSS__", &css);
    format!(
        "window.__CODEX_SWITCH_REFRESH_USAGE_STATUSLINE__ = () => {{\n\
         {registry}\n{subscription}\n{identity}\n{metrics}\n{statusline}\n}};\n\
         {selector}\nwindow.__CODEX_SWITCH_REFRESH_USAGE_STATUSLINE__();"
    )
}
