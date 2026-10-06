const { withDangerousMod, withMainApplication, withAppBuildGradle, withPodfile } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const registration = 'packages.add(com.codexswitch.connectivity.ChatConnectivityPackage())';
const marker = '// Codex Switch chat connectivity';

module.exports = function withChatConnectivity(config) {
  config = withMainApplication(config, result => {
    if (!result.modResults.contents.includes(registration)) {
      if (!result.modResults.contents.includes('return packages')) throw new Error('Cannot register chat connectivity');
      result.modResults.contents = result.modResults.contents.replace('return packages', `${registration}\nreturn packages`);
    }
    return result;
  });
  config = withDangerousMod(config, ['android', async result => {
    const target = path.join(result.modRequest.platformProjectRoot, 'app/src/main/java/com/codexswitch/connectivity');
    await fs.mkdir(target, { recursive: true });
    for (const name of ['NativeConnectivity.kt', 'ChatConnectivityModule.kt', 'ChatConnectivityPackage.kt',
      'NativeBulkReceiver.kt']) {
      await fs.copyFile(path.join(__dirname, 'connectivity', name), path.join(target, name));
    }
    const notices = path.join(result.modRequest.platformProjectRoot, 'app/src/main/assets/chat-connectivity');
    await fs.mkdir(notices, { recursive: true });
    for (const name of ['LICENSE-EasyTier', 'README.md']) await fs.copyFile(
      path.resolve(__dirname, '../../../crates/chat-connectivity', name), path.join(notices, name));
    return result;
  }]);
  config = withAppBuildGradle(config, result => {
    if (!result.modResults.contents.includes(marker)) result.modResults.contents += `
${marker}
def chatRustBuild = tasks.register('buildChatConnectivity', Exec) {
    workingDir rootProject.projectDir.parentFile
    environment 'ANDROID_NDK_HOME', android.ndkDirectory.absolutePath
    commandLine 'node', 'scripts/build-chat-connectivity.cjs', 'android',
        (project.findProperty('reactNativeArchitectures') ?: 'arm64-v8a').toString()
}
tasks.named('preBuild').configure { dependsOn(chatRustBuild) }
`;
    return result;
  });
  return withPodfile(config, result => {
    const line = "  pod 'ChatConnectivity', :path => '../plugins/connectivity'";
    if (!result.modResults.contents.includes(line)) {
      const anchor = 'use_expo_modules!';
      if (!result.modResults.contents.includes(anchor)) throw new Error('Cannot register chat connectivity pod');
      result.modResults.contents = result.modResults.contents.replace(anchor, `${anchor}\n${line}`);
    }
    return result;
  });
};
