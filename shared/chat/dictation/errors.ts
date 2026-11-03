export function recordingError(error: unknown): string {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'client.dictation.allowMicrophoneAccessThenTryAgain';
    if (error.name === 'NotFoundError') return 'client.dictation.noMicrophoneFoundConnectOneAndRetry';
    if (error.name === 'NotReadableError') return 'client.dictation.theMicrophoneIsUnavailableCloseOtherAppsUsingItAnd';
  }
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'client.dictation.transcriptionFailedPleaseRetry';
}
