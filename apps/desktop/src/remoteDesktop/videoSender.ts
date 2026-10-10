import type { DesktopProfile } from '../../../../shared/remote-desktop/profiles';

/** Every connection keeps capture's resolution, including peers awaiting a direct or relay handover. */
export async function configureDesktopSender(sender?: RTCRtpSender, profile?: DesktopProfile) {
  if (!sender) return;
  const parameters = sender.getParameters();
  parameters.degradationPreference = 'maintain-resolution';
  if (profile && parameters.encodings?.length) {
    parameters.encodings[0].maxBitrate = profile.bitrate;
    parameters.encodings[0].maxFramerate = profile.fps;
  }
  await sender.setParameters(parameters);
}
