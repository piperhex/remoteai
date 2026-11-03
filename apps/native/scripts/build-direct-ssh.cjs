const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const native = path.resolve(__dirname, '..');
const manifest = path.join(root, 'crates/ssh-mobile/Cargo.toml');
const target = path.join(root, 'crates/ssh-mobile/target');
const destination = path.join(native, 'plugins/ssh/build');
const targets = { 'arm64-v8a': 'aarch64-linux-android', 'armeabi-v7a': 'armv7-linux-androideabi',
  x86: 'i686-linux-android', x86_64: 'x86_64-linux-android' };

function run(command, args) {
  const result = spawnSync(command, args, { cwd: path.dirname(manifest), stdio: 'inherit', windowsHide: true,
    env: { ...process.env, CARGO_TARGET_DIR: target } });
  if (result.error || result.status !== 0) throw new Error(`Direct SSH build failed: ${command}`);
}

function android(architectures) {
  const abis = architectures.split(',');
  if (!abis.length || abis.some(abi => !targets[abi])) throw new Error('Unsupported Android architecture');
  run('rustup', ['target', 'add', ...abis.map(abi => targets[abi])]);
  run('cargo', ['ndk', ...abis.flatMap(abi => ['-t', abi]), '-P', '24',
    '-o', path.join(native, 'android/app/src/main/jniLibs'), 'build', '--lib', '--release', '--locked',
    '--manifest-path', manifest]);
}

function ios() {
  if (process.platform !== 'darwin') throw new Error('An Apple toolchain is required for iOS SSH');
  const triples = ['aarch64-apple-ios', 'aarch64-apple-ios-sim', 'x86_64-apple-ios'];
  run('rustup', ['target', 'add', ...triples]);
  for (const triple of triples) run('cargo', ['build', '--lib', '--release', '--locked', '--manifest-path', manifest,
    '--target', triple]);
  const simulatorDirectory = path.join(destination, 'simulator');
  fs.mkdirSync(simulatorDirectory, { recursive: true });
  const simulator = path.join(simulatorDirectory, 'libcsw_ssh_mobile.a');
  run('lipo', ['-create', ...triples.slice(1).map(triple => path.join(target, triple, 'release/libcsw_ssh_mobile.a')),
    '-output', simulator]);
  const framework = path.join(destination, 'DirectSsh.xcframework');
  // This fixed generated path is owned exclusively by this build script.
  fs.rmSync(framework, { recursive: true, force: true });
  run('xcodebuild', ['-create-xcframework', '-library', path.join(target, triples[0], 'release/libcsw_ssh_mobile.a'),
    '-library', simulator, '-output', framework]);
}

if (process.argv[2] === 'android') android(process.argv[3] ?? Object.keys(targets).join(','));
else if (process.argv[2] === 'ios') ios();
else throw new Error('Choose android or ios');
