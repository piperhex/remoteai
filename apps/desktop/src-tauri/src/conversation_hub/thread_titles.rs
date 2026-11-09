#[derive(Debug)]
struct StateThreadTitle {
    history_mode: String,
    name: Option<String>,
    title: Option<String>,
    first_user_message: Option<String>,
    preview: Option<String>,
    cwd: Option<String>,
}

fn index_values(codex_home: &Path) -> Result<HashMap<String, Value>, String> {
    let path = codex_home.join(INDEX_NAME);
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取会话索引 {}：{error}", path.display()))?;
    let mut result = HashMap::new();
    for line in content.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if let Some(id) = value.get("id").and_then(Value::as_str) {
            result.insert(id.to_string(), value);
        }
    }
    Ok(result)
}

fn title_from_index(value: &Value) -> Option<String> {
    ["thread_name", "threadName", "title", "name"]
        .into_iter()
        .filter_map(|key| value.get(key).and_then(Value::as_str))
        .find_map(non_empty_title)
}

fn non_empty_title(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn state_columns(connection: &Connection) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(threads)")
        .map_err(|error| format!("无法读取 Codex 会话表结构：{error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("无法读取 Codex 会话表字段：{error}"))?;
    columns
        .map(|column| column.map_err(|error| format!("无法解析 Codex 会话表字段：{error}")))
        .collect()
}

fn selected_column(columns: &HashSet<String>, column: &str, fallback: &str) -> String {
    if columns.contains(column) {
        column.to_string()
    } else {
        fallback.to_string()
    }
}

fn state_title_query(columns: &HashSet<String>) -> String {
    format!(
        "SELECT id, {} AS history_mode, {} AS name, {} AS title, \
         {} AS first_user_message, {} AS preview, {} AS cwd FROM threads",
        selected_column(columns, "history_mode", "'legacy'"),
        selected_column(columns, "name", "NULL"),
        selected_column(columns, "title", "NULL"),
        selected_column(columns, "first_user_message", "NULL"),
        selected_column(columns, "preview", "NULL"),
        selected_column(columns, "cwd", "NULL"),
    )
}

fn state_thread_titles(codex_home: &Path) -> Result<HashMap<String, StateThreadTitle>, String> {
    let Some(path) = latest_state_db(codex_home) else {
        return Ok(HashMap::new());
    };
    let connection = Connection::open(&path)
        .map_err(|error| format!("无法打开 Codex 会话数据库 {}：{error}", path.display()))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("无法读取 Codex 会话数据库 {}：{error}", path.display()))?;
    let columns = state_columns(&connection)?;
    if !columns.contains("id") {
        return Ok(HashMap::new());
    }
    let query = state_title_query(&columns);
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("无法查询 Codex 会话标题：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                StateThreadTitle {
                    history_mode: row.get(1)?,
                    name: row.get(2)?,
                    title: row.get(3)?,
                    first_user_message: row.get(4)?,
                    preview: row.get(5)?,
                    cwd: row.get(6)?,
                },
            ))
        })
        .map_err(|error| format!("无法读取 Codex 会话标题：{error}"))?;
    rows.map(|row| row.map_err(|error| format!("无法解析 Codex 会话标题：{error}")))
        .collect()
}

fn distinct_legacy_title(metadata: &StateThreadTitle) -> Option<String> {
    let title = metadata.title.as_deref().and_then(non_empty_title)?;
    let first_user_message = metadata
        .first_user_message
        .as_deref()
        .and_then(non_empty_title);
    (first_user_message.as_deref() != Some(title.as_str())).then_some(title)
}

fn explicit_thread_name(
    metadata: Option<&StateThreadTitle>,
    indexed: Option<&Value>,
) -> Option<String> {
    match metadata {
        Some(metadata) if metadata.history_mode == "paginated" => {
            metadata.name.as_deref().and_then(non_empty_title)
        }
        Some(metadata) => distinct_legacy_title(metadata)
            .or_else(|| indexed.and_then(title_from_index)),
        None => indexed.and_then(title_from_index),
    }
}

fn resolved_thread_title(
    metadata: Option<&StateThreadTitle>,
    indexed: Option<&Value>,
) -> Option<String> {
    explicit_thread_name(metadata, indexed).or_else(|| {
        let metadata = metadata?;
        metadata
            .preview
            .as_deref()
            .and_then(non_empty_title)
            .or_else(|| {
                metadata
                    .first_user_message
                    .as_deref()
                    .and_then(non_empty_title)
            })
            .or_else(|| metadata.title.as_deref().and_then(non_empty_title))
    })
}

pub(crate) fn resolve_codex_thread_titles(
    codex_home: &Path,
    thread_ids: &HashSet<String>,
) -> Result<HashMap<String, String>, String> {
    if thread_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let indexed = index_values(codex_home)?;
    let metadata = state_thread_titles(codex_home)?;
    Ok(thread_ids
        .iter()
        .filter_map(|id| {
            resolved_thread_title(metadata.get(id), indexed.get(id)).map(|title| (id.clone(), title))
        })
        .collect())
}
