use super::{Kind, Member};
use rusqlite::{params, Connection, Result};
use std::collections::HashSet;

pub(super) fn members(connection: &Connection) -> Result<String> {
    let mut statement = connection.prepare("PRAGMA table_info(threads)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<HashSet<_>>>()?;
    let column = |name: &str, fallback: &str| {
        if columns.contains(name) {
            format!("t.{name}")
        } else {
            fallback.to_owned()
        }
    };
    let mode = column("history_mode", "'legacy'");
    let name = column("name", "NULL");
    let title = column("title", "NULL");
    let first = column("first_user_message", "NULL");
    let preview = column("preview", &first);
    let updated = column("updated_at_ms", "t.updated_at * 1000");
    // Match thread/list's interactive-source and nonempty-preview rules. All providers and archives are included.
    let source = column("source", "'cli'");
    Ok(format!(
        "WITH conversations AS (
          SELECT t.id, COALESCE(
            CASE WHEN {mode} = 'paginated' THEN NULLIF(TRIM({name}), '')
              ELSE COALESCE(CASE WHEN TRIM({title}) <> COALESCE(TRIM({first}), '')
                THEN NULLIF(TRIM({title}), '') END, n.name) END,
            NULLIF(TRIM({preview}), ''), NULLIF(TRIM({first}), ''), NULLIF(TRIM({title}), ''), t.id) AS title,
            group_cwd(COALESCE(o.path, t.cwd)) AS cwd, t.archived, {updated} AS updated
          FROM threads t LEFT JOIN group_overrides o ON o.id = t.id LEFT JOIN group_names n ON n.id = t.id
          WHERE {source} IN ('cli', 'vscode', 'atlas', 'chatgpt') AND COALESCE({preview}, {title}, '') <> ''
        ), paths AS (
          SELECT cwd AS path FROM conversations WHERE cwd <> ''
          UNION SELECT group_cwd(path) FROM group_projects WHERE group_cwd(path) <> ''
        ), members AS (
          SELECT 'project' AS kind, paths.path AS id, COALESCE(p.name, group_basename(paths.path)) AS title,
            paths.path AS cwd, 0 AS archived, 0 AS updated
          FROM paths LEFT JOIN group_projects p ON p.path = paths.path
          UNION ALL SELECT 'thread', id, title, cwd, archived, updated FROM conversations
        ), matches AS (
          SELECT * FROM members WHERE ?1 = '' OR instr(group_lower(title || ' ' || cwd), ?1) > 0
        )"
    ))
}

pub(super) fn page(
    connection: &Connection,
    sql: &str,
    search: &str,
    paging: (u32, u32),
) -> Result<Vec<Member>> {
    let (page, size) = paging;
    let sql = format!(
        "{sql} SELECT kind, id, title, cwd, archived FROM matches
        ORDER BY kind ASC, archived ASC, updated DESC, id DESC LIMIT ?2 OFFSET ?3"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(
        params![search, size, u64::from(page - 1) * u64::from(size)],
        |row| {
            let kind: String = row.get(0)?;
            Ok(Member {
                kind: if kind == "project" {
                    Kind::Project
                } else {
                    Kind::Thread
                },
                id: row.get(1)?,
                title: row.get(2)?,
                cwd: row.get(3)?,
                archived: row.get(4)?,
            })
        },
    )?;
    rows.collect()
}
