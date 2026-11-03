import type { ReactNode } from 'react';
import { Archive, File, Package } from 'lucide-react';
import './resourceDownloadCard.css';

export function ResourceDownloadCard({ path, children }: { path: string; children: ReactNode }) {
  const name = path.split(/[\\/]/).at(-1) || path;
  const extension = name.includes('.') ? name.split('.').at(-1)?.toUpperCase() : '';
  const Icon = /\.(zip|7z|rar|gz|tar|bz2|xz)$/i.test(name) ? Archive
    : /\.(exe|msi|msix|apk|aab|dmg|pkg|deb|rpm)$/i.test(name) ? Package : File;
  return <div className="resource-download-page">
    <section className="resource-download-card" aria-label={name}>
      <div className="resource-download-icon"><Icon size={36} strokeWidth={1.5} aria-hidden="true" /></div>
      <strong className="resource-download-name">{name}</strong>
      {extension && <span className="resource-download-extension">{extension}</span>}
      <div className="resource-download-action">{children}</div>
    </section>
  </div>;
}
