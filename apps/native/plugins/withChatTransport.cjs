const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

// The base prompt uses the same generated resource as Expo's localized permission prompts.
const LOCAL_NETWORK_USAGE = require('../locales/zh.json').ios.NSLocalNetworkUsageDescription;
const MICROPHONE_USAGE = require('../locales/zh.json').ios.NSMicrophoneUsageDescription;

module.exports = function withChatTransport(config) {
  config = require('./withChatConnectivity.cjs')(config);
  require('../scripts/patch-tcp-punch.cjs').applyTcpPunchPatch();
  require('../scripts/patch-webrtc-audio.cjs').applyWebrtcAudioPatch();
  config = require('./withIosTcpPunch.cjs')(config);
  config = require('./withIosUdp.cjs')(config);
  config = withAndroidManifest(config, (result) => {
    // Incremental prebuilds retain old manifest-merger removals after blockedPermissions changes.
    for (const permission of result.modResults.manifest['uses-permission'] ?? []) {
      if (['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']
        .includes(permission.$['android:name'])) delete permission.$['tools:node'];
    }
    const application = result.modResults.manifest.application[0];
    // Expo does not map the existing android.usesCleartextTraffic setting into release manifests by itself.
    application.$['android:usesCleartextTraffic'] = config.android?.usesCleartextTraffic ? 'true' : 'false';
    return result;
  });
  // Register before permission plugins: Expo runs Info.plist mods in reverse registration order.
  return withInfoPlist(config, (result) => {
    result.modResults.NSLocalNetworkUsageDescription = LOCAL_NETWORK_USAGE;
    result.modResults.NSMicrophoneUsageDescription = MICROPHONE_USAGE;
    return result;
  });
};
module.exports.LOCAL_NETWORK_USAGE = LOCAL_NETWORK_USAGE;
module.exports.MICROPHONE_USAGE = MICROPHONE_USAGE;
