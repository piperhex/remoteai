//! Runs the actual editor service without linking the desktop UI, for isolated tests and measurements.
extern crate self as tauri;
pub mod async_runtime {
    pub use tokio::task::spawn_blocking;
}
include!(concat!(env!("OUT_DIR"), "/services.rs"));

use std::io::{BufRead, Write};

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let mut tasks = Vec::new();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(input) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        tasks.push(tokio::spawn(async move {
            let start = std::time::Instant::now();
            let result = codex_gui::handle(input.clone()).await;
            let reply = match result {
                Ok(data) => serde_json::json!({ "id": input["id"], "data": data, "ms": start.elapsed().as_secs_f64() * 1000.0 }),
                Err(error) => serde_json::json!({ "id": input["id"], "error": error.to_string(), "ms": start.elapsed().as_secs_f64() * 1000.0 }),
            };
            let mut stdout = std::io::stdout().lock();
            writeln!(stdout, "{reply}").unwrap();
            stdout.flush().unwrap();
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }
}
