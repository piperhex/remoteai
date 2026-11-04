import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = JSON.parse(readFileSync(
  new URL('../apps/desktop/src/data/tokenCostPresets.json', import.meta.url), 'utf8',
));

test("admin and desktop ship identical verified pricing defaults", () => {
  const admin = JSON.parse(readFileSync(
    new URL("../apps/admin/internal/tokenpricing/defaults.json", import.meta.url), "utf8",
  ));
  assert.deepEqual(admin, catalog);
  assert.equal(catalog.models.find((model) => model.model === "gpt-5.6-cyber").fastModeMultiplier, null);
});
