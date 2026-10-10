import { useEffect, useState } from 'react';
import { MAX_FPS } from './protocol';
import type { DisplaySettingsProps } from './displaySettings';

const DEFAULT_CUSTOM_FPS = 30;

export function useFrameRateInput({ settings, update }: Pick<DisplaySettingsProps, 'settings' | 'update'>) {
  const [custom, setCustom] = useState(String(settings.fps === 'auto' ? DEFAULT_CUSTOM_FPS : settings.fps));
  const [error, setError] = useState('');
  useEffect(() => {
    if (settings.fps !== 'auto') setCustom(String(settings.fps));
    setError('');
  }, [settings.fps]);
  const edit = (value: string) => { setCustom(value); setError(''); };
  const apply = () => {
    const fps = Number(custom);
    if (!Number.isInteger(fps) || fps < 1 || fps > MAX_FPS) {
      setError('请输入 1–144 的整数。');
      return;
    }
    setError('');
    void update({ ...settings, fps });
  };
  return { custom, error, edit, apply };
}
