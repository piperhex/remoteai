import type { MappingDocument } from '../../../shared/port-mapping/sync';

const documents = new Map<string, MappingDocument>();
const active = new Map<string, number>();
let release!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; });
export const mappingSyncFixture = { calls: 0, maxActive: 0, held: true, release: () => {
  mappingSyncFixture.held = false; release();
} };

export async function exchangeMappingFixture(args: { deviceId: string; document?: MappingDocument }) {
  mappingSyncFixture.calls++;
  const count = (active.get(args.deviceId) ?? 0) + 1;
  active.set(args.deviceId, count);
  mappingSyncFixture.maxActive = Math.max(mappingSyncFixture.maxActive, count);
  try {
    if (mappingSyncFixture.held) await gate;
    const current = documents.get(args.deviceId) ?? { revision: 0, mappings: [] };
    if (!args.document || args.document.revision !== current.revision) return current;
    const saved = { revision: current.revision + 1, mappings: args.document.mappings };
    documents.set(args.deviceId, saved);
    return { ...saved, accepted: true };
  } finally { active.set(args.deviceId, count - 1); }
}

export function mappingFixtureScope(name: string) {
  return new URLSearchParams(location.search).has('sync')
    ? JSON.stringify(['http://127.0.0.1', 'fixture-owner', name]) : `port-forwarding-e2e/${name}`;
}

declare global { interface Window { portMappingSyncFixture: typeof mappingSyncFixture } }
window.portMappingSyncFixture = mappingSyncFixture;
