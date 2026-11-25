//! Saved file metadata shared by the net patch and tool activity indexes.
use serde_json::{json, Value};

pub(super) struct File<'a> {
    pub(super) meta: Value,
    pub(super) text: &'a str,
}

impl File<'_> {
    pub(super) fn summary(mut self) -> Value {
        let (added, removed) = match self.meta["kind"]["type"].as_str() {
            Some("add") => (self.text.lines().count(), 0),
            Some("delete") => (0, self.text.lines().count()),
            _ => {
                // Only hunk content contributes lines. File headers and binary patches do not.
                self.text
                    .lines()
                    .skip_while(|line| !line.starts_with("@@ "))
                    .fold((0, 0), |(added, removed), line| {
                        (
                            added + usize::from(line.starts_with('+')),
                            removed + usize::from(line.starts_with('-')),
                        )
                    })
            }
        };
        self.meta["added"] = json!(added);
        self.meta["removed"] = json!(removed);
        self.meta
    }
}

pub(super) fn patch_files(diff: &str) -> impl Iterator<Item = File<'_>> {
    let git = diff.starts_with("diff --git ") || diff.contains("\ndiff --git ");
    let separator = if git { "\ndiff --git " } else { "\n--- " };
    let positions = move || {
        diff.match_indices(separator)
            .map(|(index, _)| index + 1)
            .filter(move |&index| {
                git || diff[index..]
                    .split_once('\n')
                    .is_some_and(|(_, tail)| tail.starts_with("+++ "))
            })
    };
    std::iter::once(0)
        .chain(positions())
        .zip(positions().chain(std::iter::once(diff.len())))
        .map(|(start, end)| {
            let text = &diff[start..end];
            let end = text.floor_char_boundary(text.len().min(16 * 1024));
            let header = text[..end]
                .lines()
                .take_while(|line| !line.starts_with("@@") && *line != "GIT binary patch")
                .take(12)
                .filter(|line| {
                    [
                        "diff --git ",
                        "--- ",
                        "+++ ",
                        "rename from ",
                        "rename to ",
                        "new file mode ",
                        "deleted file mode ",
                    ]
                    .into_iter()
                    .any(|prefix| line.starts_with(prefix))
                })
                .collect::<Vec<_>>()
                .join("\n");
            // Older viewers use a nonempty header to distinguish patch files from tool edits.
            let header = if header.is_empty() {
                "diff --git"
            } else {
                &header
            };
            File {
                meta: json!({"header":header}),
                text,
            }
        })
}
