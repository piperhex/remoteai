const { withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const PACKAGE_LINE = 'packages.add(com.codexswitch.update.AppUpdatePackage())';

module.exports = function withAppUpdate(config) {
  config = withMainApplication(config, (result) => {
    const source = result.modResults.contents;
    if (!source.includes(PACKAGE_LINE)) {
      if (!source.includes('return packages')) throw new Error('Cannot register app update status.');
      result.modResults.contents = source.replace('return packages', PACKAGE_LINE + '\n            return packages');
    }
    return result;
  });
  return withDangerousMod(config, ['android', async (result) => {
    const target = path.join(result.modRequest.platformProjectRoot, 'app/src/main/java/com/codexswitch/update');
    await fs.mkdir(target, { recursive: true });
    for (const name of ['AppUpdatePackage.kt', 'AppUpdateModule.kt', 'UpdateFiles.kt',
      'UpdatePeerDownload.kt', 'UpdateOfficialDownload.kt']) {
      await fs.copyFile(path.join(__dirname, 'appUpdate', name), path.join(target, name));
    }
    return result;
  }]);
};
