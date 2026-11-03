const { withDangerousMod, withMainApplication, withAppBuildGradle, withPodfile } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
const registration = 'packages.add(com.codexswitch.ssh.DirectSshPackage())';
const marker = '// Codex Switch direct SSH';

module.exports = function withDirectSsh(config) {
  config = withMainApplication(config, result => {
    if (!result.modResults.contents.includes(registration)) {
      if (!result.modResults.contents.includes('return packages')) throw new Error('Cannot register direct SSH');
      result.modResults.contents = result.modResults.contents.replace('return packages', `${registration}\nreturn packages`);
    }
    return result;
  });
  config = withDangerousMod(config, ['android', async result => {
    const target = path.join(result.modRequest.platformProjectRoot, 'app/src/main/java/com/codexswitch/ssh');
    await fs.mkdir(target, { recursive: true });
    for (const name of ['NativeSsh.kt', 'DirectSshModule.kt', 'DirectSshPackage.kt']) {
      await fs.copyFile(path.join(__dirname, 'ssh', name), path.join(target, name));
    }
    return result;
  }]);
  config = withAppBuildGradle(config, result => {
    if (!result.modResults.contents.includes(marker)) result.modResults.contents += `
${marker}
def directSshBuild = tasks.register('buildDirectSsh', Exec) {
    workingDir rootProject.projectDir.parentFile
    environment 'ANDROID_NDK_HOME', android.ndkDirectory.absolutePath
    commandLine 'node', 'scripts/build-direct-ssh.cjs', 'android',
        (project.findProperty('reactNativeArchitectures') ?: 'arm64-v8a').toString()
}
tasks.named('preBuild').configure { dependsOn(directSshBuild) }
`;
    return result;
  });
  return withPodfile(config, result => {
    const line = "  pod 'DirectSsh', :path => '../plugins/ssh'";
    if (!result.modResults.contents.includes(line)) {
      if (!result.modResults.contents.includes('use_expo_modules!')) throw new Error('Cannot register direct SSH pod');
      result.modResults.contents = result.modResults.contents.replace('use_expo_modules!', `use_expo_modules!\n${line}`);
    }
    return result;
  });
};
