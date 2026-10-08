import { describe, expect, it } from "vitest";
import type { QuotaSeriesPoint } from "./quotaHistoryData";
import { QUOTA_RENDER_POINT_TARGET, sampleQuotaSeries } from "./quotaSeriesSampling";

const POINT_COUNT = 100_000;
const fullRange = { startValue: 0, endValue: POINT_COUNT - 1 };
const denseSeries = (): QuotaSeriesPoint[] => Array.from({ length: POINT_COUNT }, (_, index) =>
  [index, 100 - index / POINT_COUNT * 100]);

describe("quota rendering samples", () => {
  it("bounds dense history without changing observations or endpoints", () => {
    const source = denseSeries();
    const sampled = sampleQuotaSeries(source, fullRange);
    expect(sampled.length).toBeLessThanOrEqual(QUOTA_RENDER_POINT_TARGET);
    expect(sampled[0]).toBe(source[0]);
    expect(sampled.at(-1)).toBe(source.at(-1));
    expect(sampled.every((point, index) => point === source[point[0]]
      && (!index || sampled[index - 1][0] < point[0]))).toBe(true);
    expect(source).toHaveLength(POINT_COUNT);
  });

  it("keeps brief peaks and troughs rather than averaging them away", () => {
    const source: QuotaSeriesPoint[] = Array.from({ length: POINT_COUNT }, (_, index) => [index, 50]);
    source[12_345][1] = 99;
    source[12_346][1] = 1;
    const sampled = sampleQuotaSeries(source, fullRange);
    expect(sampled).toContain(source[12_345]);
    expect(sampled).toContain(source[12_346]);
    expect(sampled.length).toBeLessThanOrEqual(QUOTA_RENDER_POINT_TARGET);
  });

  it("reduces dense flat spans to their two real endpoints", () => {
    const source: QuotaSeriesPoint[] = Array.from({ length: POINT_COUNT }, (_, index) => [index, 50]);
    expect(sampleQuotaSeries(source, fullRange)).toEqual([source[0], source.at(-1)]);
  });

  it("keeps gap boundaries and both reset endpoints even inside a sampling bucket", () => {
    const source = denseSeries();
    source[12_345][1] = null;
    source[12_346][1] = null;
    source[12_350][1] = null;
    const sampled = sampleQuotaSeries(source, fullRange);
    const gapIndex = sampled.indexOf(source[12_345]);
    expect(sampled.slice(gapIndex - 1, gapIndex + 2))
      .toEqual([source[12_344], source[12_345], source[12_347]]);
    expect(sampled).toContain(source[12_349]);
    expect(sampled).toContain(source[12_350]);
    expect(sampled).toContain(source[12_351]);
  });

  it("restores exact observations on zoom and includes a neighbor at each edge", () => {
    const source = denseSeries();
    expect(sampleQuotaSeries(source, { startValue: 12_345.5, endValue: 12_350.5 }))
      .toEqual(source.slice(12_345, 12_352));
    expect(sampleQuotaSeries(source, { startValue: 20, endValue: 25 }))
      .toEqual(source.slice(19, 26));
  });

  it("does not drop lines crossing an otherwise empty viewport or bridge missing data", () => {
    const source: QuotaSeriesPoint[] = [[0, 90], [100, 80]];
    const range = { startValue: 25, endValue: 75 };
    expect(sampleQuotaSeries(source, range)).toEqual(source);
    source.splice(1, 0, [50, null]);
    expect(sampleQuotaSeries(source, range)).toEqual(source);
  });

  it("omits entirely unknown windows, but retains zero and isolated observations", () => {
    expect(sampleQuotaSeries([], fullRange)).toEqual([]);
    expect(sampleQuotaSeries([[0, null], [1, null]], fullRange)).toEqual([]);
    expect(sampleQuotaSeries([[0, null], [1, 0], [2, null]], fullRange))
      .toEqual([[0, null], [1, 0], [2, null]]);
  });
});
