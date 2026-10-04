process.env.EXPO_NO_METRO_WORKSPACE_ROOT = '1';

const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { applyDrawerTapPatch } = require('./scripts/patch-drawer-taps.cjs');
const { applyListRenderRangePatch } = require('./scripts/patch-list-render-range.cjs');

// Cover direct Metro/Gradle builds, including installations made with --ignore-scripts.
applyDrawerTapPatch();
applyListRenderRangePatch();
require('./scripts/patch-tcp-punch.cjs').applyTcpPunchPatch();
require('./scripts/build-desktop-ime.cjs');
require('./scripts/build-text-selection.cjs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

// Keep bundle entries relative to this app while retaining access to packages
// hoisted by npm workspaces.
config.watchFolders = [workspaceRoot];
// Rust outputs are not bundle inputs. Avoid crawling transient compiler files and multi-GB native libraries.
const existingBlockList = config.resolver.blockList ?? [];
config.resolver.blockList = [...(Array.isArray(existingBlockList) ? existingBlockList : [existingBlockList]),
  /[/\\]crates[/\\]chat-connectivity[/\\]target[/\\].*/,
  /[/\\]plugins[/\\]connectivity[/\\]build[/\\].*/];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

function isReactModule(moduleName) {
  return moduleName === 'react' || moduleName.startsWith('react/');
}

// The web workspaces use React 18 while React Native uses React 19. Dependencies
// hoisted to the repository root must still share the native React instance.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (isReactModule(moduleName)) {
    return {
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
      type: 'sourceFile',
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
