import { Layers } from 'lucide-react';

export function GroupIcon({ icon, size = 16 }: { icon?: string; size?: number }) {
  return icon ? <img src={icon} width={size} height={size} alt="" draggable={false}
    style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} /> : <Layers size={size} aria-hidden="true" />;
}
