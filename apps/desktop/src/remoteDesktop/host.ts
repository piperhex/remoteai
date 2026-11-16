import { RemoteDesktopHostRegistry, type DesktopHostSessionFactory } from './hostRegistry';
import { HostSession } from './hostSession';

export type { DesktopHostSession } from './hostRegistry';

/** GUI and unattended hosts both keep capture and WebRTC in the native backend. */
export class RemoteDesktopHost extends RemoteDesktopHostRegistry {
  constructor(createSession: DesktopHostSessionFactory
    = (settings, ice, expiresAt, diagnostic) => new HostSession(settings, ice, expiresAt, diagnostic)) {
    super(createSession);
  }
}
