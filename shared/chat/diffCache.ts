interface Entry<T> { source: string; options: string; value: T; weight: number }

// The weight is a conservative accounting budget, not a measurement of JS heap usage.
export const DIFF_CACHE_LIMITS = { entries: 128, weight: 16 * 1024 * 1024 } as const;

/** Exact content keys avoid hashing/serializing entire turns or concatenating large diff strings. */
export class DiffCache<T> {
  private readonly sources = new Map<string, Map<string, Entry<T>>>();
  private readonly recent = new Set<Entry<T>>();
  private weight = 0;

  constructor(private readonly limits: { entries: number; weight: number } = DIFF_CACHE_LIMITS) {}

  get(source: string, options: string): T | undefined {
    const entry = this.sources.get(source)?.get(options);
    if (!entry) return undefined;
    this.recent.delete(entry);
    this.recent.add(entry);
    return entry.value;
  }

  set(source: string, options: string, value: T, valueWeight: number): T {
    const weight = valueWeight + (source.length + options.length) * 2;
    const previous = this.sources.get(source)?.get(options);
    if (previous) this.remove(previous);
    // Oversized diffs remain usable, but must not displace the whole working set or be retained forever.
    if (weight > this.limits.weight || this.limits.entries < 1) return value;
    while (this.recent.size >= this.limits.entries || this.weight + weight > this.limits.weight) {
      const oldest = this.recent.values().next().value;
      if (!oldest) break;
      this.remove(oldest);
    }
    const variants = this.sources.get(source) ?? new Map<string, Entry<T>>();
    const entry = { source, options, value, weight };
    variants.set(options, entry);
    this.sources.set(source, variants);
    this.recent.add(entry);
    this.weight += weight;
    return value;
  }

  private remove(entry: Entry<T>) {
    const variants = this.sources.get(entry.source);
    variants?.delete(entry.options);
    if (!variants?.size) this.sources.delete(entry.source);
    this.recent.delete(entry);
    this.weight -= entry.weight;
  }
}
