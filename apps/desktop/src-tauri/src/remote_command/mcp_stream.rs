//! Bounded STDIO dispatch. Each response holds the output lock through its final newline.
use super::{
    protocol::{MAX_CONCURRENT_COMMANDS, REQUEST_BYTES},
    RemoteError, Result,
};
use serde_json::{json, Value};
use std::{
    io::{BufRead, Read, Write},
    sync::Mutex,
    thread,
};

pub(super) fn run(
    mut input: impl BufRead,
    output: impl Write + Send,
    dispatch: impl Fn(&Value) -> Result<Value> + Sync,
) -> Result<()> {
    let output = Mutex::new(output);
    thread::scope(|scope| {
        let mut workers = Vec::new();
        while let Some(request) = read_request(&mut input)? {
            let Some(id) = request.get("id").cloned() else {
                continue;
            };
            reap(&mut workers)?;
            if workers.len() == MAX_CONCURRENT_COMMANDS {
                write_response(&output, id, Err(RemoteError::Busy))?;
                continue;
            }
            let (dispatch, output) = (&dispatch, &output);
            workers.push(scope.spawn(move || write_response(output, id, dispatch(&request))));
        }
        for worker in workers {
            worker.join().map_err(|_| RemoteError::Connection)??;
        }
        Ok(())
    })
}

fn read_request(input: &mut impl BufRead) -> Result<Option<Value>> {
    let mut line = String::new();
    let count = Read::take(input, REQUEST_BYTES + 1)
        .read_line(&mut line)
        .map_err(|_| RemoteError::Connection)?;
    if count == 0 {
        return Ok(None);
    }
    if count as u64 > REQUEST_BYTES {
        return Err(RemoteError::InvalidRequest);
    }
    serde_json::from_str(&line)
        .map(Some)
        .map_err(|_| RemoteError::InvalidRequest)
}

fn reap(workers: &mut Vec<thread::ScopedJoinHandle<'_, Result<()>>>) -> Result<()> {
    let mut index = 0;
    while index < workers.len() {
        if workers[index].is_finished() {
            workers
                .swap_remove(index)
                .join()
                .map_err(|_| RemoteError::Connection)??;
        } else {
            index += 1;
        }
    }
    Ok(())
}

fn write_response(output: &Mutex<impl Write>, id: Value, result: Result<Value>) -> Result<()> {
    let response = match result {
        Ok(result) => json!({"jsonrpc":"2.0", "id":id, "result":result}),
        Err(error) => json!({"jsonrpc":"2.0", "id":id,
            "error":{"code":-32602,"message":error.to_string()}}),
    };
    let mut output = output.lock().map_err(|_| RemoteError::Connection)?;
    serde_json::to_writer(&mut *output, &response).map_err(|_| RemoteError::Connection)?;
    output
        .write_all(b"\n")
        .and_then(|()| output.flush())
        .map_err(|_| RemoteError::Connection)
}

#[cfg(test)]
#[path = "mcp_stream_tests.rs"]
mod tests;
