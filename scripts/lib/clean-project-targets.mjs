import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { safePath } from './clean-project-safety.mjs';

// Only reproducible output locations belong here; never infer targets from all ignored files.
const parentBuildPaths = [
  'dist', '.nx', '.webview2-test', 'coverage', 'test-results', 'playwright-report', 'blob-report',
  'apps/desktop/dist', 'apps/desktop/src-tauri/target',
  'apps/desktop/src-tauri/installer-helper/target',
  'apps/desktop/e2e/native-ssh/src-tauri/target',
  'apps/desktop/test-results', 'apps/desktop/playwright-report',
  'apps/website/dist', 'apps/website/.prerender',
  'apps/website/test-results', 'apps/website/playwright-report',
  'crates/chat-connectivity/target', 'crates/ssh-client/target',
  'crates/ssh-mobile/target', 'crates/provider-balance-script/target',
  'scripts/installer-fixture/target', 'scripts/project-editor-harness/target',
];
const commonBuildPaths = ['dist', 'coverage', 'test-results', 'playwright-report', 'blob-report'];
const childBuildPaths = {
  'apps/admin': ['dist', 'coverage.out', 'testdata/results', 'testdata/bin'],
  'apps/admin-ui': commonBuildPaths,
  'apps/coze': [...commonBuildPaths, 'target'],
  'apps/native': [
    'dist', 'build', '.expo', 'android/build', 'android/app/build',
    'android/.gradle', 'android/.cxx', 'android/app/.cxx', 'ios/build',
    'plugins/connectivity/build', 'plugins/ssh/build',
  ],
  'apps/web': commonBuildPaths,
  'packages/i18n': commonBuildPaths,
  shared: commonBuildPaths,
};

export function repositoryTargets() {
  return [
    { path: '.', build: parentBuildPaths, temporaryRoots: ['.', 'apps/desktop', 'apps/website', 'scripts'] },
    ...Object.entries(childBuildPaths).map(([path, build]) => ({ path, build, temporaryRoots: ['.'] })),
  ];
}

export function temporaryTargets(root, directories) {
  return directories.flatMap(directory => {
    const absolute = join(root, directory);
    if (!existsSync(absolute)) return [];
    if (directory !== '.' && !safePath(root, directory)) return [];
    return readdirSync(absolute, { withFileTypes: true })
      .filter(entry => /^(?:\.codex-tmp(?:-.+)?|\.artifacts|\.tmp)$/.test(entry.name))
      .map(entry => join(directory, entry.name).replaceAll('\\', '/'));
  });
}
