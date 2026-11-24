//! A missing final diff can still be proven empty for matching, inverse tool edits.
use serde_json::Value;
use std::collections::HashMap;

#[derive(Default, PartialEq)]
struct Image<'a> {
    exists: bool,
    hunks: Vec<(&'a str, Vec<&'a str>)>,
}

fn images(edit: &Value) -> Option<(Image<'_>, Image<'_>)> {
    let diff = edit["diff"].as_str()?;
    let whole = |exists| Image {
        exists,
        hunks: if exists {
            vec![("", vec![diff])]
        } else {
            vec![]
        },
    };
    match edit["kind"]["type"].as_str()? {
        "add" => return Some((whole(false), whole(true))),
        "delete" => return Some((whole(true), whole(false))),
        "update" if edit["kind"]["movePath"].is_null() => (),
        _ => return None,
    }
    let mut pre = Image {
        exists: true,
        ..Image::default()
    };
    let mut post = Image {
        exists: true,
        ..Image::default()
    };
    for line in diff.split_inclusive('\n') {
        if let Some(header) = line.strip_prefix("@@ ") {
            let mut fields = header.split_ascii_whitespace();
            pre.hunks.push((fields.next()?.strip_prefix('-')?, vec![]));
            post.hunks.push((fields.next()?.strip_prefix('+')?, vec![]));
            if fields.next()? != "@@" {
                return None;
            }
        } else {
            let (sign, text) = line.split_at_checked(1)?;
            if !matches!(sign, "+" | "-" | " ") {
                return None;
            }
            if sign != "+" {
                pre.hunks.last_mut()?.1.push(text);
            }
            if sign != "-" {
                post.hunks.last_mut()?.1.push(text);
            }
        }
    }
    (!pre.hunks.is_empty()).then_some((pre, post))
}

pub(super) fn cancelled(edits: &[Value]) -> bool {
    let mut files: HashMap<&str, Vec<(Image, Image)>> = HashMap::new();
    for item in edits {
        if item["status"] != "completed" {
            return false;
        }
        let Some(changes) = item["changes"].as_array() else {
            return false;
        };
        for edit in changes {
            let (Some(path), Some((pre, post))) = (edit["path"].as_str(), images(edit)) else {
                return false;
            };
            let stack = files.entry(path).or_default();
            if stack
                .last()
                .is_some_and(|(old, new)| pre == *new && post == *old)
            {
                stack.pop();
            } else {
                stack.push((pre, post));
            }
        }
    }
    !files.is_empty() && files.values().all(Vec::is_empty)
}
