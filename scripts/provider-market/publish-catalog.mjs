import { isDeepStrictEqual } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const INVOKE_URL = 'http://127.0.0.1:9999/__codex_switch__/api/invoke';
const CATALOG_PATH = new URL('../../docs/provider-market/cc-switch-codex.json', import.meta.url);
const RECEIPT_PATH = new URL('../../.codex-tmp/provider-import/receipt.json', import.meta.url);
const PUBLIC_FIELDS = ['name', 'description', 'baseUrl', 'currency', 'unit', 'models', 'balanceQuery', 'pageLink'];

export function publicFields(item) {
  return Object.fromEntries(PUBLIC_FIELDS.map(key => [key, item[key] ?? null]));
}

export function planImport(entries, existing) {
  const seen = new Set();
  return entries.map(({ draft }) => {
    const name = draft.name.toLowerCase();
    if (seen.has(name)) throw new Error(`Duplicate catalog name: ${draft.name}`);
    seen.add(name);
    const matches = existing.filter(item => item.name.toLowerCase() === name || item.baseUrl === draft.baseUrl);
    if (!matches.length) return { draft, existing: null };
    if (matches.length !== 1 || !isDeepStrictEqual(publicFields(matches[0]), publicFields(draft))) {
      throw new Error(`Existing market entry differs; manual review required: ${draft.name}`);
    }
    if (!matches[0].published) throw new Error(`Existing entry is unpublished: ${draft.name}`);
    return { draft, existing: matches[0] };
  });
}

async function invoke(command, args = {}) {
  const response = await fetch(INVOKE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args }), signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Local application returned HTTP ${response.status}`);
  const reply = await response.json();
  if (!reply.ok) throw new Error(reply.error ?? 'Local application request failed');
  return reply.result;
}

async function identity() {
  const state = await invoke('get_cloud_auth_state');
  if (!state.authenticated || !state.userId || !state.baseUrl) throw new Error('Sign in to the local application');
  return { userId: state.userId, baseUrl: state.baseUrl };
}

async function listEntries(account, scope) {
  const items = [];
  for (let page = 1; page <= 10_000; page++) {
    const result = await invoke('cloud_provider_market', {
      identity: account, request: { type: 'list', scope, search: '', page },
    });
    if (!Array.isArray(result.items) || !Number.isInteger(result.total)) throw new Error('Invalid market page');
    items.push(...result.items);
    if (items.length >= result.total) return items;
    if (!result.items.length) throw new Error('Incomplete market pagination');
  }
  throw new Error('Market pagination limit exceeded');
}

async function validateCatalog(catalog) {
  // Use the application's actual public schema validation before any writes.
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../shared/provider-market/validation.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm',
  });
  const { validDraft } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text)
    .toString('base64')}`);
  if (catalog.schema !== 'remoteai.provider-market.cc-switch-import.v1') throw new Error('Unknown catalog schema');
  if (catalog.entries.length !== catalog.configurationCount) throw new Error('Catalog count mismatch');
  for (const { draft } of catalog.entries) {
    if (!validDraft(draft) || !draft.pageLink?.url) throw new Error(`Invalid draft: ${draft.name}`);
    if (!isDeepStrictEqual(publicFields(draft), draft)) throw new Error(`Unexpected public fields: ${draft.name}`);
  }
}

function writeReceipt(receipt) {
  mkdirSync(new URL('../../.codex-tmp/provider-import/', import.meta.url), { recursive: true });
  writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
}

async function publishOne({ entry, account, receipt }) {
  if (entry.existing) return entry.existing;
  const saved = await invoke('cloud_provider_market', {
    identity: account, request: { type: 'save', published: true, draft: entry.draft },
  });
  if (!saved.published || saved.ownerId !== account.userId
    || !isDeepStrictEqual(publicFields(saved), publicFields(entry.draft))) {
    throw new Error(`Publication verification failed: ${entry.draft.name}`);
  }
  receipt.created.push({ id: saved.id, name: saved.name, revision: saved.revision });
  writeReceipt(receipt);
  console.log(`Published ${receipt.created.length}: ${saved.name}`);
  return saved;
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--publish')) throw new Error('Usage: publish-catalog.mjs [--publish]');
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  await validateCatalog(catalog);
  const account = await identity();
  const all = await listEntries(account, 'all');
  const mine = await listEntries(account, 'mine');
  const existing = [...new Map([...all, ...mine].map(item => [item.id, item])).values()];
  const plan = planImport(catalog.entries, existing);
  console.log(JSON.stringify({ platforms: catalog.platformCount, configurations: plan.length,
    create: plan.filter(entry => !entry.existing).length, existing: plan.filter(entry => entry.existing).length }));
  if (!process.argv.includes('--publish')) return;
  const receipt = { source: catalog.source, baseUrl: account.baseUrl, startedAt: new Date().toISOString(),
    before: { public: all.length, mine: mine.length }, created: [], verified: [] };
  writeReceipt(receipt);
  for (const entry of plan) {
    if (!isDeepStrictEqual(await identity(), account)) throw new Error('Account changed; publication stopped');
    const saved = await publishOne({ entry, account, receipt });
    const readback = await invoke('cloud_provider_market', {
      identity: null, request: { type: 'get', id: saved.id },
    });
    if (!readback.published || !isDeepStrictEqual(publicFields(readback), publicFields(entry.draft))) {
      throw new Error(`Public readback failed: ${entry.draft.name}`);
    }
    receipt.verified.push({ id: readback.id, name: readback.name });
    writeReceipt(receipt);
  }
  const after = await listEntries(account, 'all');
  const verified = planImport(catalog.entries, after);
  if (verified.some(entry => !entry.existing)) throw new Error('Final public listing is incomplete');
  receipt.finishedAt = new Date().toISOString();
  receipt.after = { public: after.length, verified: verified.length };
  writeReceipt(receipt);
  console.log(`Verified ${verified.length} public configurations; receipt saved locally.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
