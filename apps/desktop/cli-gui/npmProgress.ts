import { observePackageDownloads } from './downloadProgress';

// Loaded only inside our npm child. Its IPC channel is private to the installation worker.
if (process.send) observePackageDownloads(progress => {
  if (!process.connected) return;
  process.send?.({ type: 'install-progress', progress }, error => {
    if (error && process.connected) console.error('Installation progress delivery failed', error.message);
  });
});
