const MAX_ENTRIES = 32;
const MAX_BYTES = 2 * 1024 * 1024;

/** Bounds retained UTF-16 source keys and SVG strings, rather than just the entry count. */
export class MermaidCache {
  private readonly entries = new Map<string, string>();
  private bytes = 0;

  constructor(private readonly limits = { entries: MAX_ENTRIES, bytes: MAX_BYTES }) {}

  get size() { return this.entries.size; }
  get retainedBytes() { return this.bytes; }

  get(key: string) {
    const svg = this.entries.get(key);
    if (svg !== undefined) { this.entries.delete(key); this.entries.set(key, svg); }
    return svg;
  }

  set(key: string, svg: string) {
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.bytes -= (key.length + previous.length) * 2;
      this.entries.delete(key);
    }
    const bytes = (key.length + svg.length) * 2;
    if (bytes > this.limits.bytes) return;
    this.entries.set(key, svg); this.bytes += bytes;
    while (this.entries.size > this.limits.entries || this.bytes > this.limits.bytes) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]); this.bytes -= (oldest[0].length + oldest[1].length) * 2;
    }
  }
}

/** Reusing SVG must not duplicate IDs, CSS scopes, marker URLs or accessibility references. */
export function instantiateMermaidSvg(svg: string, instanceId: string) {
  const template = document.createElement('template');
  template.innerHTML = svg;
  const ids = new Map<string, string>();
  template.content.querySelectorAll('[id]').forEach((element, index) => {
    ids.set(element.id, `${instanceId}-${index}`);
  });
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const references = new RegExp(`#(${[...ids.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})`
    + '(?![\\w-])', 'g');
  const replace = (value: string) => ids.size
    ? value.replace(references, (match, id: string) => `#${ids.get(id) ?? match.slice(1)}`) : value;
  template.content.querySelectorAll('*').forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === 'id') element.id = ids.get(attribute.value) ?? attribute.value;
      else if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
        attribute.value = attribute.value.split(/\s+/).map(id => ids.get(id) ?? id).join(' ');
      } else if (attribute.localName === 'href' && attribute.value.startsWith('#')) {
        const target = ids.get(attribute.value.slice(1));
        attribute.value = target ? `#${target}` : attribute.value;
      } else {
        attribute.value = attribute.value.replace(/url\([^)]*\)/g, replace);
      }
    }
    if (element.tagName.toLowerCase() === 'style') element.textContent = replace(element.textContent ?? '');
  });
  return template.innerHTML;
}
