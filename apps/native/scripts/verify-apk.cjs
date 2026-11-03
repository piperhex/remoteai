const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RELEASE_ARCHITECTURES = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];
const MAX_ARCHIVE_LISTING_BYTES = 16 * 1024 * 1024;
const EASYTIER_TARGET_LIBRARY = /^libeasytier_core-[0-9a-f]{16}\.so$/;
const REQUIRED_LIBRARIES = [
  'libcsw_chat_connectivity.so',
  'libcsw_ssh_mobile.so',
  'libappmodules.so',
  'libc++_shared.so',
  'libexpo-modules-core.so',
  'libexpo-sqlite.so',
  'libfbjni.so',
  'libgesturehandler.so',
  'libhermes.so',
  'libreactnative.so',
  'libreanimated.so',
  'libworklets.so',
];

function validateNativeEntries(entries) {
  const libraries = new Map(RELEASE_ARCHITECTURES.map((abi) => [abi, new Set()]));
  const requiredLibraries = new Set(REQUIRED_LIBRARIES);
  for (const entry of entries) {
    const match = /^lib\/([^/]+)\/([^/]+\.so)$/.exec(entry);
    if (!match) continue;
    const [, abi, library] = match;
    if (!libraries.has(abi)) throw new Error(`Unexpected APK architecture: ${abi}`);
    // Rust fingerprints differ between targets. Require the same library family for every ABI,
    // without requiring an ARM build's filename to appear in an x86 directory.
    const identity = EASYTIER_TARGET_LIBRARY.test(library) ? 'libeasytier_core.so' : library;
    const names = libraries.get(abi);
    if (identity !== library && names.has(identity)) {
      throw new Error(`Multiple EasyTier builds packaged for ${abi}`);
    }
    names.add(identity);
    requiredLibraries.add(identity);
  }

  const missing = [];
  for (const [abi, names] of libraries) {
    for (const library of requiredLibraries) {
      if (!names.has(library)) missing.push(`lib/${abi}/${library}`);
    }
  }
  if (missing.length) {
    throw new Error(`APK is missing native libraries:\n${missing.join('\n')}`);
  }
  return [...libraries].map(([abi, names]) => `${abi}: ${names.size} libraries`).join(', ');
}

function verifyApk(apkPath) {
  // Android builds already require a JDK; jar reads the APK without extracting it or adding a ZIP dependency.
  const jarName = process.platform === 'win32' ? 'jar.exe' : 'jar';
  const jar = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', jarName) : jarName;
  const entries = execFileSync(jar, ['tf', path.resolve(apkPath)], {
    encoding: 'utf8',
    maxBuffer: MAX_ARCHIVE_LISTING_BYTES,
    windowsHide: true,
  }).split(/\r?\n/);
  return validateNativeEntries(entries);
}

if (require.main === module) {
  const apkPath = process.argv[2]
    ?? path.resolve(__dirname, '../android/app/build/outputs/apk/release/app-release.apk');
  try {
    console.log(`Verified APK native libraries: ${verifyApk(apkPath)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { RELEASE_ARCHITECTURES, validateNativeEntries, verifyApk };
