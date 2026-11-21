// Match process.rs, including the newline consumed by the Rust reader.
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export function workerFrame(value: object) {
  const line = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(line) <= MAX_FRAME_BYTES) return line;
  // Fail only this RPC; an oversized line would terminate the reader and cancel every pending request.
  return JSON.stringify('id' in value ? { id: value.id, error: 'client.cliGui.requestFailed' }
    : { event: true, params: {} }) + '\n';
}
