import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { BrowserSurfaceProps } from '../../../../../../shared/provider-market/ProviderBrowser';
import { WebsiteBrowserSurface } from './ManagedBrowserSurface';
import type { FilePreviewTarget } from './usePreviewHistory';

export interface BrowserResource {
  key: string;
  title: string;
  url: string;
  render: (props: BrowserSurfaceProps) => ReactNode;
  release?: () => void;
}

export const BrowserResourcesContext = createContext<ReadonlyMap<string, BrowserResource>>(new Map());
export const RemoteBrowserResourceContext = createContext<((target: FilePreviewTarget) => BrowserResource) | null>(null);

/** File sessions belong to their tab, including while another page or file is visible. */
export function useBrowserResources() {
  const resources = useMemo(() => new Map<string, BrowserResource>(), []);
  const clear = useMemo(() => () => {
    resources.forEach(resource => resource.release?.()); resources.clear();
  }, [resources]);
  useEffect(() => clear, [clear]);
  return { resources, clear };
}

export function ResourceBrowserSurface(props: BrowserSurfaceProps) {
  const resource = useContext(BrowserResourcesContext).get(props.tab.id);
  if (!resource || resource.url !== props.tab.url) return <WebsiteBrowserSurface {...props} />;
  return <div className="website-resource-page"
    key={props.command?.action === 'reload' ? props.command.sequence : 0}>{resource.render(props)}</div>;
}

export function fileResourceKey(target: { path: string; threadId: string | null; line?: number; column?: number }) {
  return JSON.stringify([target.threadId, target.path, target.line, target.column]);
}

export function fileResourceUrl(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const encoded = normalized.split('/').map(encodeURIComponent).join('/').replace(/^([a-z])%3A/i, '$1:');
  return `file://${normalized.startsWith('/') ? '' : '/'}${encoded}`;
}
