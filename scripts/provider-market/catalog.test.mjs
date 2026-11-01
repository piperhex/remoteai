import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { convertPreset, isThirdParty } from './build-cc-switch.mjs';
import { planImport } from './publish-catalog.mjs';

const catalog = JSON.parse(readFileSync(new URL('../../docs/provider-market/cc-switch-codex.json', import.meta.url)));
const entries = catalog.entries;

test('the source snapshot covers 79 platform families and all 84 configurations', () => {
  assert.equal(entries.length, 84);
  assert.equal(new Set(entries.map(entry => entry.source.family ?? entry.source.name)).size, 79);
  assert.equal(new Set(entries.map(entry => entry.draft.name)).size, 84);
  assert.deepEqual(entries.filter(entry => entry.source.family).map(entry => entry.source.family).sort(),
    ['compshare', 'compshare', 'opencode', 'opencode', 'siliconflow', 'siliconflow',
      'soruxgpt', 'soruxgpt', 'sudocode', 'sudocode']);
});

test('classification follows picker categories, including aggregators and the Azure template', () => {
  assert.equal(isThirdParty({ category: 'aggregator' }), true);
  assert.equal(isThirdParty({ category: 'third_party', isOfficial: true }), true);
  for (const excluded of [{ hidden: true }, { isCustomTemplate: true }, { requiresOAuth: true },
    { providerType: 'github_copilot' }, { category: 'cn_official' }, { category: 'cloud_provider' }]) {
    assert.equal(isThirdParty(excluded), false);
  }
});

test('mapping preserves the default model, catalogs and native protocol without importing credentials', () => {
  const converted = convertPreset({ name: 'Example', websiteUrl: 'https://example.test',
    auth: { OPENAI_API_KEY: '' }, apiFormat: 'openai_chat',
    config: 'model = "second"\nbase_url = "https://api.example.test/v1"',
    modelCatalog: [{ model: 'first' }, { model: 'second' }] });
  assert.deepEqual(converted.draft.models.map(model => [model.id, model.protocol]),
    [['second', 'openaiChat'], ['first', 'openaiChat']]);
  assert.equal('auth' in converted.draft, false);
  assert.equal('apiKey' in converted.draft, false);
  assert.equal(converted.draft.models[0].tiers[0].input, null);
  assert.throws(() => convertPreset({ auth: { OPENAI_API_KEY: 'private' } }), /credentials/);
});

test('prices remain unspecified and chat providers keep their native protocol', () => {
  const chat = entries.filter(entry => entry.draft.models[0].protocol === 'openaiChat');
  assert.equal(chat.length, 14);
  for (const { draft } of entries) {
    for (const model of draft.models) {
      assert.equal(model.tiers[0].input, null);
      assert.equal(model.tiers[0].output, null);
      assert.equal(model.tiers[0].cachedInput, null);
    }
  }
  const azure = entries.find(entry => entry.draft.name === 'Azure OpenAI');
  assert.equal(azure.draft.baseUrl, `${azure.source.baseUrl}/v1`);
  assert.ok(azure.draft.description.includes('YOUR_RESOURCE_NAME'));
});

test('repeated imports skip exact publications and stop on conflicting or unpublished entries', () => {
  const sample = entries.slice(0, 2);
  const existing = { ...sample[0].draft, id: 'existing', published: true };
  const plan = planImport(sample, [existing]);
  assert.equal(plan[0].existing.id, 'existing');
  assert.equal(plan[1].existing, null);
  assert.throws(() => planImport(sample, [{ ...existing, description: 'Another publication' }]), /differs/);
  assert.throws(() => planImport(sample, [{ ...existing, published: false }]), /unpublished/);
  assert.throws(() => planImport([sample[0], sample[0]], []), /Duplicate/);
  assert.throws(() => planImport(sample, [existing, { ...existing, id: 'duplicate' }]), /differs/);
});
