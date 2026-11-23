import { describe, expect, it } from 'vitest';
import type { ServerSample } from '../../../../../shared/terminal/ssh';
import { formatServerSpeed, serverRates } from '../../../../../shared/terminal/workspace/serverMetrics';

const sample: ServerSample = {
  cpu: [500, 200], cpuPercent: null, network: [8192, 4000], memory: null, disk: null, uptimeSeconds: 60,
};

describe('SSH server monitoring', () => {
  it('uses byte rates independently in both directions over the actual sample interval', () => {
    const current = { ...sample, cpu: [700, 250], network: [12288, 4500] } satisfies ServerSample;
    expect(serverRates({ values: current, time: 3000 }, { values: sample, time: 1000 }))
      .toEqual({ cpu: 75, download: 2048, upload: 250 });
    expect(serverRates({ values: sample, time: 1000 }).download).toBeUndefined();
    expect(serverRates({ values: sample, time: 4000 }, { values: current, time: 3000 }).upload).toBeUndefined();
  });

  it('formats zero, missing measurements and each power-of-1024 boundary', () => {
    expect(formatServerSpeed(undefined, 'en')).toBe('—');
    expect(formatServerSpeed(0, 'en')).toBe('0 B/s');
    expect(formatServerSpeed(1536, 'en')).toBe('1.5 KB/s');
    for (const [index, unit] of ['B', 'KB', 'MB', 'GB', 'TB', 'PB'].entries()) {
      expect(formatServerSpeed(1024 ** index, 'en')).toBe(`1 ${unit}/s`);
    }
  });
});
