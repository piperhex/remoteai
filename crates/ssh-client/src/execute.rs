//! Bounded, non-interactive commands using the same authentication and host verification as terminals.
use crate::{connection, Client, Connect, Error, Result, MAX_INPUT_BYTES};
use russh::{Channel, ChannelMsg, Disconnect};
use serde::Serialize;
use std::time::Duration;

const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_TIMEOUT_SECONDS: u64 = 120;

pub struct ExecutionOptions {
    pub command: String,
    pub timeout_seconds: u64,
}

impl ExecutionOptions {
    pub fn validate(&self) -> Result<()> {
        if self.command.trim().is_empty()
            || self.command.len() > MAX_INPUT_BYTES
            || self.command.contains('\0')
            || !(1..=MAX_TIMEOUT_SECONDS).contains(&self.timeout_seconds)
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Execution {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<u32>,
    pub timed_out: bool,
    pub truncated: bool,
}

#[derive(Default)]
struct Output {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_code: Option<u32>,
    truncated: bool,
}

impl Output {
    fn append(&mut self, data: &[u8], stderr: bool) {
        let remaining = MAX_OUTPUT_BYTES.saturating_sub(self.stdout.len() + self.stderr.len());
        let length = data.len().min(remaining);
        self.truncated |= length < data.len();
        let target = if stderr {
            &mut self.stderr
        } else {
            &mut self.stdout
        };
        target.extend_from_slice(&data[..length]);
    }

    fn finish(self, timed_out: bool) -> Execution {
        Execution {
            stdout: String::from_utf8_lossy(&self.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&self.stderr).into_owned(),
            exit_code: self.exit_code,
            timed_out,
            truncated: self.truncated,
        }
    }
}

async fn collect(channel: &mut Channel<russh::client::Msg>, output: &mut Output) -> Result<()> {
    while let Some(event) = channel.wait().await {
        match event {
            ChannelMsg::Data { data } => output.append(&data, false),
            ChannelMsg::ExtendedData { data, .. } => output.append(&data, true),
            ChannelMsg::ExitStatus { exit_status } => output.exit_code = Some(exit_status),
            ChannelMsg::Failure => return Err(Error::Connection),
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "execute_tests.rs"]
mod integration_tests;

impl Client {
    /// Returns partial output on timeout. The command may have run and must not be retried implicitly.
    pub async fn execute(&self, request: Connect, options: ExecutionOptions) -> Result<Execution> {
        request.validate()?;
        options.validate()?;
        let _permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Limit)?;
        let session =
            tokio::time::timeout(connection::TIMEOUT, connection::connect(&request, None))
                .await
                .map_err(|_| Error::Connection)??;
        let result = execute_channel(&session, options).await;
        if session
            .disconnect(Disconnect::ByApplication, "", "")
            .await
            .is_err()
        {
            // Commands such as shutdown may close the transport before local cleanup.
        }
        result
    }
}

async fn execute_channel(
    session: &russh::client::Handle<connection::HostKey>,
    options: ExecutionOptions,
) -> Result<Execution> {
    let mut output = Output::default();
    let timed_out = tokio::time::timeout(Duration::from_secs(options.timeout_seconds), async {
        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|_| Error::Connection)?;
        channel
            .exec(true, options.command.as_bytes())
            .await
            .map_err(|_| Error::Connection)?;
        channel.eof().await.map_err(|_| Error::Connection)?;
        collect(&mut channel, &mut output).await
    })
    .await;
    match timed_out {
        Ok(result) => {
            result?;
            Ok(output.finish(false))
        }
        Err(_) => Ok(output.finish(true)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_combined_output_and_preserves_timeout_and_exit_status() {
        let mut output = Output::default();
        output.append("你好".as_bytes(), false);
        output.append(&vec![b'e'; MAX_OUTPUT_BYTES], true);
        output.append(b"discarded", false);
        output.exit_code = Some(7);
        let result = output.finish(true);
        assert_eq!(result.stdout, "你好");
        assert_eq!(result.stdout.len() + result.stderr.len(), MAX_OUTPUT_BYTES);
        assert!(result.truncated && result.timed_out);
        assert_eq!(result.exit_code, Some(7));
    }

    #[test]
    fn validates_commands_and_timeouts_before_connecting() {
        for (command, timeout_seconds) in [
            ("".into(), 30),
            ("bad\0command".into(), 30),
            ("x".repeat(MAX_INPUT_BYTES + 1), 30),
            ("pwd".into(), 0),
            ("pwd".into(), 121),
        ] {
            assert!(ExecutionOptions {
                command,
                timeout_seconds
            }
            .validate()
            .is_err());
        }
        assert!(ExecutionOptions {
            command: "printf '%s' 'hello world'".into(),
            timeout_seconds: 30
        }
        .validate()
        .is_ok());
    }
}
