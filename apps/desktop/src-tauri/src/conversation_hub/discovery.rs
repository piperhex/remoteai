fn normalized_ids(values: Vec<String>) -> HashSet<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn unix_seconds(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_i64() {
        return Some(if number > 10_000_000_000 {
            number / 1000
        } else {
            number
        });
    }
    let text = value.as_str()?.trim();
    if let Ok(number) = text.parse::<i64>() {
        return Some(if number > 10_000_000_000 {
            number / 1000
        } else {
            number
        });
    }
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|date| date.timestamp())
}

fn modified_seconds(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

fn index_timestamp(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    [
        "updated_at",
        "updatedAt",
        "last_updated_at",
        "lastUpdatedAt",
    ]
    .into_iter()
    .filter_map(|key| value.get(key))
    .find_map(unix_seconds)
}

fn compressed_rollout_path(path: &Path) -> PathBuf {
    path.with_extension("jsonl.zst")
}

fn logical_rollout_path(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    if name.starts_with("rollout-") && name.ends_with(".jsonl") {
        return Some(path.to_path_buf());
    }
    if name.starts_with("rollout-") && name.ends_with(".jsonl.zst") {
        return Some(path.with_file_name(name.trim_end_matches(".zst")));
    }
    None
}

fn rollout_physical_paths(logical_path: &Path) -> Vec<PathBuf> {
    [
        logical_path.to_path_buf(),
        compressed_rollout_path(logical_path),
    ]
    .into_iter()
    .filter(|path| path.is_file())
    .collect()
}

fn preferred_rollout_path(logical_path: &Path) -> Option<PathBuf> {
    logical_path
        .is_file()
        .then(|| logical_path.to_path_buf())
        .or_else(|| {
            let compressed = compressed_rollout_path(logical_path);
            compressed.is_file().then_some(compressed)
        })
}

fn rollout_reader(path: &Path) -> Result<Box<dyn BufRead>, String> {
    let file = File::open(path)
        .map_err(|error| format!("无法打开会话文件 {}：{error}", path.display()))?;
    if path.extension().and_then(|value| value.to_str()) == Some("zst") {
        let decoder = zstd::stream::read::Decoder::new(file)
            .map_err(|error| format!("无法解压会话文件 {}：{error}", path.display()))?;
        Ok(Box::new(BufReader::new(decoder)))
    } else {
        Ok(Box::new(BufReader::new(file)))
    }
}

fn collect_rollout_paths(root: &Path, result: &mut Vec<PathBuf>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)
        .map_err(|error| format!("无法读取会话目录 {}：{error}", root.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取会话目录项：{error}"))?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            collect_rollout_paths(&path, result)?;
        } else if let Some(logical) = logical_rollout_path(&path) {
            result.push(logical);
        }
    }
    Ok(())
}

fn first_rollout_value(path: &Path) -> Result<Option<Value>, String> {
    for line in rollout_reader(path)?.lines() {
        let line = line.map_err(|error| format!("无法读取会话文件 {}：{error}", path.display()))?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            return Ok(None);
        };
        return Ok(
            (value.get("type").and_then(Value::as_str) == Some("session_meta")).then_some(value),
        );
    }
    Ok(None)
}

fn snapshot_id(meta: &Value) -> Option<String> {
    meta.pointer("/payload/id")
        .or_else(|| meta.pointer("/payload/session_id"))
        .or_else(|| meta.get("id"))
        .or_else(|| meta.get("session_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn snapshot_cwd(meta: &Value) -> Option<String> {
    meta.pointer("/payload/cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn snapshot_reference_id(meta: &Value, field: &str) -> Option<String> {
    meta.pointer(&format!("/payload/{field}/thread_id"))
        .or_else(|| meta.pointer(&format!("/payload/{field}/threadId")))
        .or_else(|| meta.pointer(&format!("/payload/{field}")))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn gather_snapshots(codex_home: &Path) -> Result<Vec<RolloutSnapshot>, String> {
    let index = index_values(codex_home)?;
    let state_titles = state_thread_titles(codex_home)?;
    let mut files = Vec::new();
    for folder in ROLLOUT_FOLDERS {
        collect_rollout_paths(&codex_home.join(folder), &mut files)?;
    }
    files.sort();
    files.dedup();
    let mut snapshots = Vec::new();
    for logical_path in files {
        let Some(path) = preferred_rollout_path(&logical_path) else {
            continue;
        };
        let physical_paths = rollout_physical_paths(&logical_path);
        let Some(meta) = first_rollout_value(&path)? else {
            continue;
        };
        let Some(session_id) = snapshot_id(&meta) else {
            continue;
        };
        let indexed = index.get(&session_id);
        let state_title = state_titles.get(&session_id);
        let explicit_name = explicit_thread_name(state_title, indexed);
        let title = resolved_thread_title(state_title, indexed)
            .unwrap_or_else(|| session_id.clone());
        let cwd = state_title
            .and_then(|state| state.cwd.as_ref())
            .map(|cwd| cwd.trim().to_owned())
            .or_else(|| snapshot_cwd(&meta))
            .unwrap_or_default();
        let updated_at = index_timestamp(indexed).or_else(|| modified_seconds(&path));
        let relative_path = path.strip_prefix(codex_home).unwrap_or(&path).to_path_buf();
        let index_value = indexed.cloned().unwrap_or_else(|| {
            explicit_name.as_ref().map_or_else(
                || json!({ "id": session_id }),
                |name| json!({ "id": session_id, "thread_name": name }),
            )
        });
        let size_bytes = physical_paths
            .iter()
            .filter_map(|path| fs::metadata(path).ok())
            .map(|item| item.len())
            .sum();
        let history_base_thread_id = snapshot_reference_id(&meta, "history_base");
        let parent_thread_id = snapshot_reference_id(&meta, "parent_thread_id")
            .or_else(|| snapshot_reference_id(&meta, "parent_thread"))
            .or_else(|| snapshot_reference_id(&meta, "forked_from_id"))
            .or_else(|| {
                meta.pointer("/payload/source/subagent/thread_spawn/parent_thread_id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        snapshots.push(RolloutSnapshot {
            session_id,
            title,
            explicit_name,
            cwd,
            updated_at,
            path,
            physical_paths,
            relative_path,
            index_value,
            size_bytes,
            history_base_thread_id,
            parent_thread_id,
        });
    }
    Ok(snapshots)
}

fn thread_kind(title: &str, cwd: &str) -> String {
    let text = format!("{title} {cwd}").to_ascii_lowercase();
    if text.contains("subagent") || text.contains("sub-agent") || text.contains("agent run") {
        "subagent".to_string()
    } else if text.contains("external") || text.contains("imported") || text.contains("cli run") {
        "external".to_string()
    } else {
        "conversation".to_string()
    }
}

fn clipped_match(value: &str, needle: &str) -> Option<String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let lowered = normalized.to_lowercase();
    let lowered_needle = needle.to_lowercase();
    let hit = lowered.find(&lowered_needle)?;
    let hit_chars = lowered[..hit].chars().count();
    let start = hit_chars.saturating_sub(48);
    let take = lowered_needle.chars().count().saturating_add(112);
    let total_chars = normalized.chars().count();
    let body = normalized
        .chars()
        .skip(start)
        .take(take)
        .collect::<String>();
    Some(format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        body,
        if start.saturating_add(take) < total_chars {
            "…"
        } else {
            ""
        }
    ))
}

fn matching_json_text(value: &Value, needle: &str) -> Option<String> {
    match value {
        Value::String(text) => clipped_match(text, needle),
        Value::Array(values) => values
            .iter()
            .find_map(|value| matching_json_text(value, needle)),
        Value::Object(values) => {
            for key in ["content", "text", "message", "input", "output"] {
                if let Some(found) = values
                    .get(key)
                    .and_then(|value| matching_json_text(value, needle))
                {
                    return Some(found);
                }
            }
            values
                .values()
                .find_map(|value| matching_json_text(value, needle))
        }
        _ => None,
    }
}

fn locate_rollout_text(path: &Path, needle: &str) -> Result<Option<String>, String> {
    for line in rollout_reader(path)?.lines() {
        let line = line.map_err(|error| format!("无法搜索会话文件 {}：{error}", path.display()))?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("session_meta") {
            continue;
        }
        if let Some(found) = matching_json_text(&value, needle) {
            return Ok(Some(found));
        }
    }
    Ok(None)
}

pub(crate) fn browse_codex_threads_blocking<R: Runtime>(
    app: ThreadContext<R>,
    title_query: Option<String>,
    content_query: Option<String>,
) -> Result<Vec<ThreadEntry>, String> {
    reconcile_legacy_bin(&app)?;
    let paths = app.paths.clone();
    let codex_home = paths.codex_home.clone();
    let snapshots = gather_snapshots(&codex_home)?;
    let state = sync_thread_ownership(&paths, &snapshots)?;
    let account_emails = account_email_by_id(&paths);
    let title_query = title_query
        .map(|value| value.trim().to_lowercase())
        .filter(|v| !v.is_empty());
    let content_query = content_query
        .map(|value| value.trim().to_string())
        .filter(|v| !v.is_empty());
    let mut entries = Vec::new();
    for snapshot in snapshots {
        let title_matches = title_query
            .as_ref()
            .is_some_and(|query| snapshot.title.to_lowercase().contains(query));
        let match_excerpt = match content_query.as_deref() {
            Some(_) if title_query.is_some() && title_matches => None,
            Some(query) => locate_rollout_text(&snapshot.path, query)?,
            None => None,
        };
        let matches = match (title_query.is_some(), content_query.is_some()) {
            (true, true) => title_matches || match_excerpt.is_some(),
            (true, false) => title_matches,
            (false, true) => match_excerpt.is_some(),
            (false, false) => true,
        };
        if !matches {
            continue;
        }
        let account_id = state
            .conversation_account_ids
            .get(&snapshot.session_id)
            .cloned();
        let account_email = account_id
            .as_deref()
            .and_then(|id| account_emails.get(id).cloned());
        let account_active = account_id
            .as_deref()
            .zip(state.active_account_id.as_deref())
            .is_some_and(|(thread_account, active_account)| thread_account == active_account);
        entries.push(ThreadEntry {
            session_id: snapshot.session_id,
            session_kind: thread_kind(&snapshot.title, &snapshot.cwd),
            title: snapshot.title,
            cwd: snapshot.cwd,
            updated_at: snapshot.updated_at,
            size_bytes: snapshot.size_bytes,
            match_excerpt,
            account_id,
            account_email,
            account_active,
        });
    }
    Ok(merge_thread_entries(entries))
}

fn merge_thread_entries(entries: Vec<ThreadEntry>) -> Vec<ThreadEntry> {
    let mut unique = HashMap::<String, ThreadEntry>::new();
    for mut entry in entries {
        let Some(current) = unique.get_mut(&entry.session_id) else {
            unique.insert(entry.session_id.clone(), entry);
            continue;
        };
        let size_bytes = current.size_bytes.saturating_add(entry.size_bytes);
        if entry.updated_at > current.updated_at {
            std::mem::swap(current, &mut entry);
        }
        current.size_bytes = size_bytes;
        current.match_excerpt = current.match_excerpt.take().or(entry.match_excerpt);
    }
    let mut entries = unique.into_values().collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        right
            .updated_at
            .unwrap_or_default()
            .cmp(&left.updated_at.unwrap_or_default())
            .then_with(|| left.cwd.cmp(&right.cwd))
            .then_with(|| left.title.cmp(&right.title))
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    entries
}

fn token_totals(path: &Path) -> Option<(u64, u64, u64)> {
    let mut latest = None;
    for line in rollout_reader(path).ok()?.lines().map_while(Result::ok) {
        if !line.contains("\"token_count\"") || !line.contains("\"total_token_usage\"") {
            continue;
        }
        let value = serde_json::from_str::<Value>(&line).ok()?;
        let usage = value.pointer("/payload/info/total_token_usage")?;
        latest = Some((
            usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            usage
                .get("total_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        ));
    }
    latest
}

pub(crate) fn measure_codex_thread_tokens_blocking<R: Runtime>(
    app: ThreadContext<R>,
    session_ids: Vec<String>,
) -> Result<Vec<ThreadTokenTotals>, String> {
    let requested = normalized_ids(session_ids);
    let codex_home = app.paths.codex_home.clone();
    Ok(gather_snapshots(&codex_home)?
        .into_iter()
        .filter(|item| requested.contains(&item.session_id))
        .filter_map(|item| {
            let (input_tokens, output_tokens, total_tokens) = token_totals(&item.path)?;
            Some(ThreadTokenTotals {
                session_id: item.session_id,
                input_tokens,
                output_tokens,
                total_tokens,
            })
        })
        .collect())
}
