const fs = require('node:fs');
const path = require('node:path');
const anchor = '    public void onMessage(DataChannel.Buffer buffer) {';
const replacement = `${anchor}
        if (buffer.binary && "remote-ai-file-v1".equals(mDataChannel.label())) {
            try {
                Class<?> router = Class.forName("com.codexswitch.downloads.DownloadBulkRouter");
                router.getMethod("receive", java.nio.ByteBuffer.class).invoke(null, buffer.data);
            } catch (ReflectiveOperationException error) {
                mDataChannel.close();
            }
            return;
        }`;

function patch(source) {
  const normalized = source.replace(/\r\n/g, '\n');
  if (normalized.includes(replacement)) return source;
  if (normalized.split(anchor).length !== 2) throw new Error('Review WebRTC binary downloads before upgrading.');
  return normalized.replace(anchor, replacement);
}
function applyBulkPatch() {
  const manifest = require.resolve('react-native-webrtc/package.json', { paths: [path.resolve(__dirname, '..')] });
  const file = path.join(path.dirname(manifest), 'android/src/main/java/com/oney/WebRTCModule/DataChannelWrapper.java');
  const source = fs.readFileSync(file, 'utf8'); const result = patch(source);
  if (source !== result) fs.writeFileSync(file, result);
}
if (require.main === module) applyBulkPatch();
module.exports = { patch, applyBulkPatch };
