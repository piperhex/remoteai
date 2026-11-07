//! Strip only a recognized PowerShell launcher before bounding its display summary.
pub(super) const MAX_PREVIEW_CHARS: usize = 1024;

fn powershell_script(command: &str) -> Option<&str> {
    let command = command.trim();
    let (launcher, mut arguments) = if let Some(quoted) = command.strip_prefix('"') {
        quoted.split_once('"')?
    } else {
        command.split_once(char::is_whitespace)?
    };
    let name = launcher.rsplit(['/', '\\']).next()?.to_ascii_lowercase();
    if !matches!(
        name.as_str(),
        "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
    ) {
        return None;
    }
    loop {
        let (option, remaining) = arguments.trim_start().split_once(char::is_whitespace)?;
        match option.to_ascii_lowercase().as_str() {
            "-noprofile" | "-nologo" | "-noninteractive" => arguments = remaining,
            "-command" | "-c" => return Some(remaining.trim_start()),
            _ => return None,
        }
    }
}

pub(super) fn preview(command: &str) -> String {
    let script = powershell_script(command)
        .map(|script| {
            let quote = script
                .chars()
                .next()
                .filter(|quote| matches!(quote, '\'' | '"'));
            quote
                .and_then(|quote| script.strip_prefix(quote)?.strip_suffix(quote))
                .unwrap_or(script)
        })
        .unwrap_or(command);
    text_preview(script)
}

pub(super) fn text_preview(text: &str) -> String {
    let mut characters = Vec::new();
    let mut space = false;
    for character in text.chars() {
        if character.is_whitespace() {
            space = !characters.is_empty();
            continue;
        }
        if space {
            characters.push(' ');
        }
        space = false;
        characters.push(character);
        if characters.len() > MAX_PREVIEW_CHARS {
            characters.truncate(MAX_PREVIEW_CHARS - 1);
            while characters.last().is_some_and(|character| *character == ' ') {
                characters.pop();
            }
            characters.push('…');
            break;
        }
    }
    characters.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrapper_does_not_consume_the_preview_budget() {
        let script = "git -C F:/projects/remoteai diff -- ".to_owned() + &"文件😀 ".repeat(400);
        let command =
            format!("\"C:\\WINDOWS\\System32\\powershell.exe\" -NoProfile -Command \"{script}\"");
        let result = preview(&command);
        assert!(result.starts_with("git -C F:/projects/remoteai diff -- 文件😀"));
        assert!(result.ends_with('…'));
        assert_eq!(result.chars().count(), MAX_PREVIEW_CHARS);
    }

    #[test]
    fn short_previews_preserve_commands_and_normalize_whitespace() {
        for (command, expected) in [
            ("pwsh -NoLogo -NonInteractive -c 'echo hello'", "echo hello"),
            ("powershell -Command Get-Date", "Get-Date"),
            ("powershell -Command \"unclosed", "\"unclosed"),
            ("powershell -File script.ps1", "powershell -File script.ps1"),
            (
                "echo \"powershell -Command hello\"",
                "echo \"powershell -Command hello\"",
            ),
            ("  npm\n   test  ", "npm test"),
        ] {
            assert_eq!(preview(command), expected);
        }
    }
}
