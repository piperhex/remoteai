export { CHAT_POLICY_FIELDS, DEFAULT_CHAT_POLICY, parseChatPolicy, type ChatPolicy }
  from '../chat/chatPolicy';
import { DEFAULT_CHAT_POLICY, parseChatPolicy } from '../chat/chatPolicy';
import type { ConnectionMode } from './protocol';

export const CHAT_POLICY_MESSAGE = 'chat-policy';
export const KIB = 1024;
export const MIB = KIB * KIB;
let current = { ...DEFAULT_CHAT_POLICY };
let clientMode: ConnectionMode = 'offline';
const policyListeners = new Set<() => void>();
export function subscribeChatPolicy(listener: () => void) {
  policyListeners.add(listener);
  return () => { policyListeners.delete(listener); };
}
export function setChatConnectionMode(mode: ConnectionMode) { clientMode = mode; }
export function isDirectChat(mode: ConnectionMode = clientMode) { return mode === 'direct'; }
export function getChatPolicy(mode: ConnectionMode = clientMode) {
  if (!isDirectChat(mode)) return current;
  return { ...current, imageSourceMaxMb: Number.MAX_SAFE_INTEGER, imageMaxEdge: Number.MAX_SAFE_INTEGER,
    imageTargetKb: Number.MAX_SAFE_INTEGER, fileUploadMaxMb: Number.MAX_SAFE_INTEGER,
    fileUploadTotalMaxMb: Number.MAX_SAFE_INTEGER, filePreviewMaxMb: Number.MAX_SAFE_INTEGER,
    imagePreviewMaxMb: Number.MAX_SAFE_INTEGER, videoPreviewMaxMb: Number.MAX_SAFE_INTEGER,
    fileDownloadMaxMb: Number.MAX_SAFE_INTEGER };
}
/** Only configuration received from the authenticated coordinator may update these limits. */
export function setChatPolicy(value: unknown) {
  current = parseChatPolicy(value);
  policyListeners.forEach(listener => listener());
}
export function base64Bytes(data: string) {
  const encoded = data.slice(data.indexOf(',') + 1);
  return Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : Number(encoded.endsWith('=')));
}
/** Saturate only at JavaScript's exact byte-offset range, without a product size cap. */
export function videoByteLimit(mode?: ConnectionMode) {
  return Math.min(Number.MAX_SAFE_INTEGER, getChatPolicy(mode).videoPreviewMaxMb * MIB);
}
export function imagePreviewByteLimit(mode?: ConnectionMode) {
  return Math.min(Number.MAX_SAFE_INTEGER, getChatPolicy(mode).imagePreviewMaxMb * MIB);
}
export function imagePreviewCharLimit(mode?: ConnectionMode) {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(imagePreviewByteLimit(mode) / 3) * 4 + 64);
}
export function textPreviewByteLimit(mode?: ConnectionMode) {
  return Math.min(Number.MAX_SAFE_INTEGER, getChatPolicy(mode).filePreviewMaxMb * MIB);
}
export function fileUploadByteLimit(mode?: ConnectionMode) {
  return Math.min(Number.MAX_SAFE_INTEGER, getChatPolicy(mode).fileUploadMaxMb * MIB);
}
export function fileUploadTotalByteLimit(mode?: ConnectionMode) {
  return Math.min(Number.MAX_SAFE_INTEGER, getChatPolicy(mode).fileUploadTotalMaxMb * MIB);
}
export function checkFileUploadSize(bytes: number, mode?: ConnectionMode) {
  if (bytes > fileUploadByteLimit(mode)) {
    throw new Error(`单个文件不能超过 ${current.fileUploadMaxMb} MB，请选择较小的文件。`);
  }
}
export class DownloadPolicyError extends Error {}
export function fileDownloadByteLimit(mode?: ConnectionMode) {
  return Math.min(Number.MAX_SAFE_INTEGER, getChatPolicy(mode).fileDownloadMaxMb * MIB);
}
export function checkDownloadSize(bytes: number) {
  if (bytes > fileDownloadByteLimit()) {
    throw new DownloadPolicyError(`文件超过 ${current.fileDownloadMaxMb} MB，无法下载。`);
  }
}
