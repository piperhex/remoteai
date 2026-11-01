$taskMutex = [System.Threading.Mutex]::new($false, 'Local\RemoteAI_codex_switch_heavy_verification')
$taskHeld = $false
try {
  try { $taskHeld = $taskMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $taskHeld = $true }
  if (-not $taskHeld) { Write-Output 'HEAVY_MUTEX_BUSY'; exit 2 }
  Write-Output 'TASK4_NATIVE_HEAVY_ACQUIRED'
  $env:CARGO_PKG_NAME='token-lifecycle-probe'
  rustc --edition 2021 .codex-tmp/token-lifecycle/native-probe.rs --crate-name token_lifecycle_probe `
    --extern tauri=apps/desktop/src-tauri/target/debug/deps/libtauri-b704990c05c7bb01.rlib `
    --extern serde_json=apps/desktop/src-tauri/target/debug/deps/libserde_json-d96fb6262e7c204c.rlib `
    -L dependency=apps/desktop/src-tauri/target/debug/deps `
    -L native=apps/desktop/src-tauri/target/debug/build/webview2-com-sys-34507d4e1ccbfc1b/out/x64 `
    -L native=C:/Users/CXR/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_x86_64_msvc-0.52.6/lib `
    -o .codex-tmp/token-lifecycle/native-probe.exe 2>&1 | Tee-Object .codex-tmp/token-lifecycle/native-build.log
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & 'C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64/mt.exe' '-manifest' `
    'F:/projects/codex-switch/.codex-tmp/token-lifecycle/native-probe.exe.manifest' `
    '-outputresource:F:/projects/codex-switch/.codex-tmp/token-lifecycle/native-probe.exe;#1'
  exit $LASTEXITCODE
} finally {
  if ($taskHeld) { $taskMutex.ReleaseMutex() }
  $taskMutex.Dispose()
  Write-Output 'TASK4_NATIVE_HEAVY_RELEASED'
}
