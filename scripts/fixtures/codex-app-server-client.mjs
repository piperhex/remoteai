import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { join } from "node:path";

const TIMEOUT_MS = 30000;

export function connectAppServer({ executable, home, cwd, overrides = [] }) {
  const quotePath = (path) => JSON.stringify(path.replaceAll("\\", "/"));
  const child = spawn(executable, ["app-server", ...overrides.flatMap((value) => ["-c", value]),
    "-c", "features.step_model_switching=true",
    "-c", `sqlite_home=${quotePath(home)}`, "-c", `log_dir=${quotePath(join(home, "log"))}`], {
    cwd, env: { ...process.env, CODEX_HOME: home, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "codex-tui" },
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const events = [];
  let sequence = 0;
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-6000); });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method) { events.push(message); return; }
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id); clearTimeout(call.timer);
    if (message.error) call.reject(new Error(JSON.stringify(message.error)));
    else call.resolve(message.result);
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id); reject(new Error(`Timed out: ${method}\n${stderr}`));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer }); send({ id, method, params });
  });
  return { rpc, events, async initialize() {
    await rpc("initialize", { clientInfo: { name: "codex-tui", version: "0.157.1" },
      capabilities: { experimentalApi: true } });
    send({ method: "initialized" });
  }, async waitFor(predicate) {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const event = events.find(predicate);
      if (event) return event;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Missing event\n${stderr}\n${JSON.stringify(events.slice(-5))}`);
  }, async close() {
    for (const call of pending.values()) clearTimeout(call.timer);
    lines.close();
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
  } };
}
