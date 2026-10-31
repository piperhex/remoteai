const { withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const PACKAGE_LINE = 'packages.add(com.codexswitch.systembars.ModalSystemBarsPackage())';

module.exports = function withModalSystemBars(config) {
  config = withMainApplication(config, result => {
    const source = result.modResults.contents;
    if (!source.includes(PACKAGE_LINE)) {
      if (!source.includes('return packages')) throw new Error('Cannot register modal system bars.');
      result.modResults.contents = source.replace('return packages', PACKAGE_LINE + '\n            return packages');
    }
    return result;
  });
  return withDangerousMod(config, ['android', async result => {
    const target = path.join(result.modRequest.platformProjectRoot, 'app/src/main/java/com/codexswitch/systembars');
    await fs.mkdir(target, { recursive: true });
    for (const name of ['ModalSystemBarsManager.kt', 'ModalSystemBarsPackage.kt']) {
      await fs.copyFile(path.join(__dirname, 'modalSystemBars', name), path.join(target, name));
    }
    return result;
  }]);
};
