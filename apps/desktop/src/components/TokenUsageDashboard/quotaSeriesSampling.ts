import type { QuotaSeriesPoint } from "./quotaHistoryData";

export interface QuotaVisibleRange {
  startValue: number;
  endValue: number;
}

export const QUOTA_RENDER_POINT_TARGET = 800;
const POINTS_PER_BUCKET = 4;
const BUCKET_COUNT = QUOTA_RENDER_POINT_TARGET / POINTS_PER_BUCKET;

function lowerBound(series: QuotaSeriesPoint[], timestamp: number) {
  let start = 0;
  let end = series.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (series[middle][0] < timestamp) start = middle + 1;
    else end = middle;
  }
  return start;
}

function appendPoint(result: QuotaSeriesPoint[], point: QuotaSeriesPoint) {
  const previous = result[result.length - 1];
  if (point[1] === null && previous?.[1] === null) return;
  const beforePrevious = result[result.length - 2];
  if (previous && beforePrevious && previous[1] === point[1] && beforePrevious[1] === point[1]) {
    result[result.length - 1] = point;
    return;
  }
  result.push(point);
}

function appendBucket(result: QuotaSeriesPoint[], bucket: QuotaSeriesPoint[]) {
  if (!bucket.length) return;
  let minimum = bucket[0];
  let maximum = bucket[0];
  for (const point of bucket) {
    if (Number(point[1]) < Number(minimum[1])) minimum = point;
    if (Number(point[1]) > Number(maximum[1])) maximum = point;
  }
  const points = [...new Set([bucket[0], minimum, maximum, bucket[bucket.length - 1]])];
  points.sort((left, right) => left[0] - right[0]).forEach((point) => appendPoint(result, point));
}

export function sampleQuotaSeries(series: QuotaSeriesPoint[], range: QuotaVisibleRange): QuotaSeriesPoint[] {
  const first = Math.max(0, lowerBound(series, range.startValue) - 1);
  const last = Math.min(series.length, lowerBound(series, range.endValue) + 1);
  const visible = series.slice(first, last);
  if (!visible.some(([, value]) => value !== null)) return [];
  if (visible.length <= QUOTA_RENDER_POINT_TARGET) return visible;
  const bucketWidth = Math.max(1, range.endValue - range.startValue) / BUCKET_COUNT;
  const result: QuotaSeriesPoint[] = [];
  let bucket: QuotaSeriesPoint[] = [];
  let previousBucket = -1;
  for (const point of visible) {
    const bucketIndex = Math.max(0, Math.min(BUCKET_COUNT - 1,
      Math.floor((point[0] - range.startValue) / bucketWidth)));
    if (point[1] === null || bucketIndex !== previousBucket) {
      appendBucket(result, bucket);
      bucket = [];
    }
    if (point[1] === null) appendPoint(result, point);
    else bucket.push(point);
    previousBucket = bucketIndex;
  }
  appendBucket(result, bucket);
  return result;
}
