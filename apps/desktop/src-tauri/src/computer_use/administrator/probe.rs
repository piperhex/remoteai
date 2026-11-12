//! Opt-in debug executable fixture for exercising real UAC without changing the user's Home.
use super::{
    super::{state, ComputerError, Result},
    enable, prepare_gui, revoke, status,
};
use std::io::{BufRead, Write};

pub(super) fn run(argument: &str) -> Option<Result<()>> {
    let id = argument.strip_prefix("--computer-use-authorization-probe=")?;
    Some(run_probe(id))
}

fn run_probe(id: &str) -> Result<()> {
    // This helper is absent from release builds and requires the explicit test root override.
    if std::env::var_os("CSW_COMPUTER_USE_TEST_ROOT").is_none() {
        return Err(ComputerError::Disabled);
    }
    let root = super::super::root()?;
    let record = state::read(&root, id)?.ok_or(ComputerError::Disabled)?;
    let mut output = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let command = line.map_err(|_| ComputerError::Storage)?;
        let result = match command.as_str() {
            "prepare" => prepare_gui(&record.home),
            "grant" => enable(&root, &record.home),
            "enable" => super::request(&root, &record.home),
            "revoke" => revoke(&root, &record.home),
            "status" => Ok(()),
            "exit" => break,
            _ => Err(ComputerError::Disabled),
        };
        let reply = serde_json::json!({"ok": result.is_ok(), "status": status(&root, &record.home)?,
            "error": result.err().map(|error| error.to_string())});
        writeln!(output, "{reply}").map_err(|_| ComputerError::Storage)?;
        output.flush().map_err(|_| ComputerError::Storage)?;
    }
    Ok(())
}
