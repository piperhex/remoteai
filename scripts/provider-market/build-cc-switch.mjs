import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const SOURCE_FILE = 'src/config/codexProviderPresets.ts';
const EXCLUDED = new Set(['official', 'cn_official', 'cloud_provider', 'local', 'omo', 'omo-slim']);
const PROTOCOLS = { openai_responses: 'openaiResponses', openai_chat: 'openaiChat' };
const AZURE_GUIDE = 'https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle';
const CATALOG_PATH = new URL('../../docs/provider-market/cc-switch-codex.json', import.meta.url);

// Evaluate only the trusted local preset module, with no filesystem, network, require or process globals.
function readPresets(source) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {} };
  vm.runInNewContext(code, context, { timeout: 1000 });
  return JSON.parse(JSON.stringify(context.exports.codexProviderPresets));
}

export function isThirdParty(preset) {
  return !preset.hidden && !preset.isCustomTemplate && !EXCLUDED.has(preset.category)
    && !preset.requiresOAuth && !preset.providerType;
}

function configValue(config, key) {
  const match = config.match(new RegExp(`^${key}\\s*=\\s*("[^"\\n]*")`, 'm'));
  if (!match) throw new Error(`Missing preset config field: ${key}`);
  return JSON.parse(match[1]);
}

function emptyTier() {
  const price = () => ({ input: null, output: null, cachedInput: null });
  return { multiplier: 1, ...price(), longContextThreshold: null, longContext: price() };
}

export function convertPreset(preset) {
  const protocol = PROTOCOLS[preset.apiFormat ?? 'openai_responses'];
  if (!protocol) throw new Error(`Unsupported protocol: ${preset.name}`);
  if (Object.values(preset.auth).some(value => value !== '')) throw new Error('Nonempty preset credentials');
  const originalBaseUrl = configValue(preset.config, 'base_url');
  const defaultModel = configValue(preset.config, 'model');
  const models = [...new Set([defaultModel, ...(preset.modelCatalog ?? []).map(model => model.model)])];
  const azure = preset.name === 'Azure OpenAI';
  if (!azure && /query_params|http_headers|env_http_headers/.test(preset.config)) {
    throw new Error(`Unmapped transport options: ${preset.name}`);
  }
  return {
    source: {
      name: preset.name, family: preset.family ?? null, category: preset.category ?? null,
      websiteUrl: preset.websiteUrl, apiKeyUrl: preset.apiKeyUrl ?? null, baseUrl: originalBaseUrl,
      endpointCandidates: preset.endpointCandidates ?? [],
      adaptation: azure ? { kind: 'azure-v1', reference: AZURE_GUIDE } : null,
    },
    draft: {
      name: preset.name, description: '', baseUrl: azure ? `${originalBaseUrl}/v1` : originalBaseUrl,
      currency: 'USD', unit: 'millionTokens',
      models: models.map(id => ({ id, protocol, tiers: [emptyTier()] })),
      balanceQuery: null, pageLink: { url: preset.websiteUrl, query: '', headers: {} },
    },
  };
}

function main() {
  const sourceRoot = resolve(process.argv[2] ?? '../cc-switch');
  const source = readFileSync(resolve(sourceRoot, SOURCE_FILE), 'utf8');
  const entries = readPresets(source).filter(isThirdParty).map(convertPreset);
  const platformCount = new Set(entries.map(entry => entry.source.family ?? entry.source.name)).size;
  if (platformCount !== 79 || entries.length !== 84) throw new Error('Source scope changed; review before importing');
  const azureNote = readFileSync(new URL('../../docs/provider-market/azure-template.txt', import.meta.url), 'utf8');
  entries.find(entry => entry.source.name === 'Azure OpenAI').draft.description = azureNote.trim();
  entries.sort((a, b) => a.draft.name.localeCompare(b.draft.name, 'en'));
  const catalog = {
    schema: 'remoteai.provider-market.cc-switch-import.v1',
    source: {
      repository: 'https://github.com/farion1231/cc-switch',
      revision: execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      file: SOURCE_FILE, sha256: createHash('sha256').update(source).digest('hex'),
      license: 'MIT', grouping: 'src/components/providers/forms/presetGroups.ts',
    },
    platformCount, configurationCount: entries.length, entries,
  };
  writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Prepared ${platformCount} platforms / ${entries.length} configurations: ${fileURLToPath(CATALOG_PATH)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
