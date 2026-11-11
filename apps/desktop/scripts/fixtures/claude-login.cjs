const assert = require('node:assert/strict');
const { writeFileSync, appendFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

assert.equal(process.env.PATH, '');
assert.equal(process.execPath, resolve(process.env.REMOTEAI_TEST_NODE));
assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
const args = process.argv.slice(2);
const directory = process.env.CLAUDE_CONFIG_DIR;
assert.ok(directory.includes('account data & spaces'));
appendFileSync(join(process.env.REMOTEAI_TEST_ROOT, 'commands.jsonl'), `${JSON.stringify(args)}\n`);

if (args[1] === 'login') {
  assert.deepEqual(args, ['auth', 'login', '--claudeai']);
  assert.equal(process.env.BROWSER, 'echo');
  assert.equal(process.env.CI, '1');
  console.log('https://claude.com/cai/oauth/authorize?code_challenge_method=S256'
    + '&response_type=code&state=fixture-state&code_challenge=fixture-challenge');
  process.stdin.once('data', input => {
    assert.equal(input.toString(), 'fixture-code#fixture-state\n');
    writeFileSync(join(directory, '.credentials.json'), JSON.stringify({ claudeAiOauth: {
      accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: Date.now() + 3_600_000,
      scopes: ['user:profile', 'user:inference'], subscriptionType: 'pro',
    } }));
    writeFileSync(join(directory, '.claude.json'), JSON.stringify({ oauthAccount: {
      accountUuid: 'fixture-user', organizationUuid: 'fixture-org', emailAddress: 'fixture@example.com',
    } }));
    process.exit(0);
  });
} else {
  assert.deepEqual(args, ['auth', 'status', '--json']);
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'fixture@example.com' }));
}
