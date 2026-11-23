use crate::{connection::HostKey, execute::execute_channel, Error, ExecutionOptions, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;

/// Cumulative CPU and network counters allow the UI to sample without blocking the terminal.
/// Memory and disk pairs contain used and total bytes. Missing counters are kept distinct from zero.
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSample {
    cpu: Option<[u64; 2]>,
    cpu_percent: Option<u64>,
    memory: Option<[u64; 2]>,
    disk: Option<[u64; 2]>,
    disk_path: Option<String>,
    network: Option<[u64; 2]>,
    uptime_seconds: Option<u64>,
}

fn pair(first: &str, second: &str) -> Option<[u64; 2]> {
    Some([first.parse().ok()?, second.parse().ok()?])
}

fn parse(output: &str) -> Result<ServerSample> {
    let mut sample = ServerSample::default();
    for line in output.lines() {
        let fields: Vec<_> = line.split_ascii_whitespace().collect();
        match fields.as_slice() {
            ["cpu", total, idle] => {
                sample.cpu = pair(total, idle).filter(|[total, idle]| total >= idle)
            }
            ["busy", percent] => sample.cpu_percent = percent.parse().ok().filter(|n| *n <= 100),
            ["ram", used, total] => sample.memory = pair(used, total).filter(valid_capacity),
            ["disk", used, total] => sample.disk = pair(used, total).filter(valid_capacity),
            ["vol", path]
                if path.len() == 2
                    && path.as_bytes()[0].is_ascii_alphabetic()
                    && path.ends_with(':') =>
            {
                sample.disk_path = Some((*path).to_owned());
            }
            ["net", rx, tx] => sample.network = pair(rx, tx),
            ["up", seconds] => sample.uptime_seconds = seconds.parse().ok(),
            _ => {}
        }
    }
    if sample.cpu.is_none()
        && sample.cpu_percent.is_none()
        && sample.memory.is_none()
        && sample.disk.is_none()
        && sample.network.is_none()
        && sample.uptime_seconds.is_none()
    {
        return Err(Error::Connection);
    }
    Ok(sample)
}

fn valid_capacity([used, total]: &[u64; 2]) -> bool {
    *total > 0 && used <= total
}

#[derive(Clone, Copy)]
pub(crate) enum Platform {
    Unix,
    Windows,
}

impl Platform {
    fn command(self) -> String {
        match self {
            Self::Unix => {
                let script = include_str!("monitor.sh")
                    .replace("\r\n", "\n")
                    .replace('\'', "'\\''");
                format!("sh -c '{script}'")
            }
            Self::Windows => {
                // PowerShell expects UTF-16LE for a script passed through the SSH server's default shell.
                let script = include_str!("monitor.ps1")
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect::<Vec<_>>();
                format!(
                    "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand {}",
                    STANDARD.encode(script)
                )
            }
        }
    }
}

pub(crate) async fn sample(
    session: &russh::client::Handle<HostKey>,
    platform: &mut Option<Platform>,
) -> Result<ServerSample> {
    // Only fixed read-only commands run on this separate channel of the verified SSH connection.
    if platform.is_none() {
        let probe = execute_channel(
            session,
            ExecutionOptions {
                command: "uname -s".into(),
                timeout_seconds: 4,
            },
        )
        .await?;
        if probe.timed_out {
            return Err(Error::Connection);
        }
        let name = probe.stdout.trim().to_ascii_uppercase();
        let windows = probe.exit_code != Some(0)
            || ["MINGW", "MSYS", "CYGWIN"]
                .iter()
                .any(|prefix| name.starts_with(prefix));
        *platform = Some(if windows {
            Platform::Windows
        } else {
            Platform::Unix
        });
    }
    let result = execute_channel(
        session,
        ExecutionOptions {
            command: platform.ok_or(Error::Connection)?.command(),
            timeout_seconds: 8,
        },
    )
    .await?;
    if result.timed_out || result.truncated || result.exit_code != Some(0) {
        return Err(Error::Connection);
    }
    parse(&result.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_real_zeroes_and_drops_unavailable_or_malformed_measurements() {
        let sample =
            parse("banner\ncpu 24 40\nram 4096 1024\ndisk 0 12\nnet 0 512\nup bad").unwrap();
        assert_eq!(sample.disk, Some([0, 12]));
        assert_eq!(sample.network, Some([0, 512]));
        assert!(sample.cpu.is_none() && sample.memory.is_none() && sample.uptime_seconds.is_none());
        assert!(parse("Permission denied").is_err());
    }
}
