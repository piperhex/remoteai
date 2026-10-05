import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(new URL('../testdata/tools/package.json', import.meta.url));
const { Client } = require('pg');
const bootstrapDatabase = 'admin_go_bootstrap';
const containerName = 'codex-admin-bootstrap-test';
const projectName = 'codex-admin-parity';
const goOnlyTables = ['token_cost_preset_settings', 'user_login_locks', 'chat_relay_user_limits',
  'chat_relay_user_months', 'chat_relay_user_hours', 'chat_relay_budgets', 'chat_relay_bulk_leases',
  'chat_push_subscriptions', 'chat_push_deliveries', 'desktop_service_credentials'];

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
}

function serviceContainer(service) {
  const id = docker('ps', '-q', '--filter', `label=com.docker.compose.project=${projectName}`,
    '--filter', `label=com.docker.compose.service=${service}`);
  assert.ok(id && !id.includes('\n'), `exactly one local ${service} container is required`);
  return id;
}

function schema(postgres, database, legacyOnly = false) {
  const dump = docker('exec', postgres, 'pg_dump', '-U', 'parity', '-d', database,
    '--schema-only', '--no-owner', '--no-privileges',
    ...(legacyOnly ? goOnlyTables.map((table) => `--exclude-table=public.${table}`) : []))
    .split('\n').filter((line) => !line.startsWith('\\restrict ') && !line.startsWith('\\unrestrict '))
    .join('\n');
  // GUI columns are asserted separately; the frozen Nest schema cannot contain them.
  return legacyOnly ? dump.replace(/^    "gui(?:Account|Provider)Id" character varying\(120\),?\n/gm, '')
    .replace(/,\n\);/g, '\n);') : dump;
}

async function checkGuiColumns(name) {
  const client = await database(name);
  try {
    const columns = await client.query(`SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns WHERE table_schema='public' AND table_name='remote_devices'
      AND column_name IN ('guiAccountId', 'guiProviderId') ORDER BY column_name`);
    assert.deepEqual(columns.rows, ['guiAccountId', 'guiProviderId'].map((column_name) => ({
      column_name, data_type: 'character varying', character_maximum_length: 120, is_nullable: 'YES',
    })));
  } finally { await client.end(); }
}

async function database(name) {
  assert.ok(['legacy', 'admin_go', bootstrapDatabase].includes(name));
  const client = new Client({ host: '127.0.0.1', port: 15432, user: 'parity',
    password: 'local-parity-only', database: name });
  await client.connect();
  return client;
}

async function startBootstrap(config) {
  const env = config.Config.Env.filter((item) => !/^(POSTGRES_DB|POSTGRES_DB_SYNCHRONIZE|CHAT_STUN_PORT)=/.test(item));
  const network = Object.keys(config.NetworkSettings.Networks)[0];
  assert.equal(network, `${projectName}_default`, 'migration tests only use the isolated fixture network');
  docker('run', '-d', '--name', containerName, '--network', network, '-p', '127.0.0.1:28082:8080',
    ...env.flatMap((item) => ['-e', item]), '-e', `POSTGRES_DB=${bootstrapDatabase}`,
    '-e', 'POSTGRES_DB_SYNCHRONIZE=true', '-e', 'CHAT_STUN_PORT=0',
    process.env.PARITY_GO_IMAGE || config.Config.Image);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:28082/auth/me');
      if (response.status === 401) return;
    } catch { /* The container is still connecting and initializing its empty schema. */ }
    await delay(250);
  }
  throw new Error(`Bootstrap service did not start:\n${docker('logs', containerName)}`);
}

async function stopBootstrap() {
  const id = docker('ps', '-aq', '--filter', `name=^/${containerName}$`);
  if (id) docker('rm', '-f', containerName);
}

export async function runMigrations() {
  const postgres = serviceContainer('postgres');
  const config = JSON.parse(docker('inspect', serviceContainer('admin-go')))[0];
  const original = schema(postgres, 'legacy');
  await checkGuiColumns('admin_go');
  assert.equal(schema(postgres, 'admin_go', true), original, 'existing Go database must retain every legacy schema object');
  console.log('PASS existing PostgreSQL columns, defaults, indexes and constraints match');
  await stopBootstrap();
  const admin = await database('legacy');
  try {
    // This fixed, isolated database is owned exclusively by this test.
    await admin.query(`DROP DATABASE IF EXISTS ${bootstrapDatabase} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${bootstrapDatabase}`);
    await startBootstrap(config);
    await checkGuiColumns(bootstrapDatabase);
    assert.equal(schema(postgres, bootstrapDatabase, true), original, 'empty-database initialization must reproduce legacy schema');
    console.log('PASS empty database initialized with the complete legacy schema');
    const fresh = await database(bootstrapDatabase);
    try {
      const tables = await fresh.query(`SELECT count(*)::int AS total FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
      assert.equal(tables.rows[0].total, 30 + goOnlyTables.length);
      assert.equal(schema(postgres, bootstrapDatabase), schema(postgres, 'admin_go'),
        'new and upgraded databases must have identical Go tables');
      const guiSchema = schema(postgres, bootstrapDatabase);
      const guiMigration = readFileSync(new URL('../sql/20260924-device-gui-model-selection.sql', import.meta.url), 'utf8');
      await fresh.query(guiMigration);
      await fresh.query(guiMigration);
      assert.equal(schema(postgres, bootstrapDatabase), guiSchema, 'GUI migration reruns must preserve schema');
      const pricing = { models: [], sentinel: 'preserve saved pricing' };
      await fresh.query("INSERT INTO token_cost_preset_settings (id, presets) VALUES ('current', $1)", [pricing]);
      const migration = readFileSync(new URL('../sql/20260923-token-cost-presets.sql', import.meta.url), 'utf8');
      await fresh.query(migration);
      await fresh.query(migration);
      assert.deepEqual((await fresh.query('SELECT presets FROM token_cost_preset_settings')).rows,
        [{ presets: pricing }]);
      console.log('PASS pricing migration is additive and preserves saved presets on rerun');
      await fresh.query('CREATE TABLE migration_sentinel (id integer PRIMARY KEY, message text NOT NULL)');
      await fresh.query('INSERT INTO migration_sentinel VALUES (1,$1)', ['retain customer data']);
      const withSentinel = schema(postgres, bootstrapDatabase);
      await stopBootstrap();
      await startBootstrap(config);
      assert.equal(schema(postgres, bootstrapDatabase), withSentinel, 'startup must not alter an existing database');
      assert.deepEqual((await fresh.query('SELECT * FROM migration_sentinel')).rows,
        [{ id: 1, message: 'retain customer data' }]);
      console.log('PASS repeated startup preserves existing schema and customer data');
    } finally { await fresh.end(); }
  } finally {
    await stopBootstrap();
    await admin.query(`DROP DATABASE IF EXISTS ${bootstrapDatabase} WITH (FORCE)`);
    await admin.end();
  }
  return [{ label: 'existing schema unchanged' }, { label: 'empty schema initialization' },
    { label: 'idempotent initialization and data preservation' }];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runMigrations();
