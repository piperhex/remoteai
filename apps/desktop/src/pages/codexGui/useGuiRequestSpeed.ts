import { useEffect, useState } from 'react';
import type { RequestSpeed } from '../../../../../shared/remote-chat/composer';
import { guiRequestSpeed } from './requestSpeedBridge';

export function useGuiRequestSpeed(active: boolean) {
  const [speed, setSpeed] = useState<RequestSpeed>();
  useEffect(() => {
    if (!active) return;
    let listening = true;
    const update = (value: RequestSpeed) => { if (listening) setSpeed(value); };
    const stop = guiRequestSpeed.subscribe(update);
    void guiRequestSpeed.read().then(update).catch(() => {
      // Keep the last confirmed speed while the shared bridge retries a failed refresh.
    });
    return () => { listening = false; stop(); };
  }, [active]);
  return speed;
}
