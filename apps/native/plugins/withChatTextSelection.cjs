const { withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const PACKAGE_LINE = 'packages.add(0, com.codexswitch.selection.ChatTextSelectionPackage())';

module.exports = function withChatTextSelection(config) {
  config = withMainApplication(config, (result) => {
    const source = result.modResults.contents.replace(
      'packages.add(com.codexswitch.selection.ChatTextSelectionPackage())', PACKAGE_LINE);
    result.modResults.contents = source;
    if (!source.includes(PACKAGE_LINE)) {
      if (!source.includes('return packages')) throw new Error('Cannot register chat text selection.');
      result.modResults.contents = source.replace('return packages', PACKAGE_LINE + '\n            return packages');
    }
    return result;
  });
  return withDangerousMod(config, ['android', async (result) => {
    const target = path.join(result.modRequest.platformProjectRoot, 'app/src/main/java/com/codexswitch/selection');
    await fs.mkdir(target, { recursive: true });
    const files = ['ChatTextSelectionPackage.kt', 'ChatTextSelectionModule.kt', 'ChatSelectionMenu.kt',
      'ChatSelectionController.kt', 'ChatSelectionTouch.kt', 'ChatTextViewManager.kt'];
    for (const name of files) {
      await fs.copyFile(path.join(__dirname, 'chatTextSelection', name), path.join(target, name));
    }
    return result;
  }]);
};
