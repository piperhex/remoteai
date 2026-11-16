import { spawn } from 'node:child_process';

/** The executable is a Rust test target, never the full desktop application. */
export function channelRust(executable) {
  if (!executable) throw new Error('Pass the optimized Rust test executable');
  const child = spawn(executable, ['native_rtc::benchmark::android_sender_throughput',
    '--exact', '--ignored', '--nocapture'], { windowsHide: true });
  const result = new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    child.on('error', reject);
    child.on('exit', code => {
      const marker = output.match(/NATIVE_RTC_BENCHMARK (\{[^\r\n]+\})/);
      if (code !== 0 || !marker) reject(new Error(`Native benchmark failed (${code}): ${output.slice(-4000)}`));
      else resolve(JSON.parse(marker[1]));
    });
  });
  result.catch(() => {});
  return { result, close: () => { if (child.exitCode === null) child.kill(); } };
}
