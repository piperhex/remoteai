import { useEffect, useState } from 'react';

export function useDocumentVisible(active = true) {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    if (!active) return;
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [active]);
  // Selection can change while unsubscribed; do not briefly mount work into a hidden document.
  return active && visible && document.visibilityState !== 'hidden';
}
