import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Synthetic parser work, not a browser latency benchmark. No checkout or production telemetry is changed.
const baseline = process.argv[2] ?? '04776426e';
const output = '.codex-tmp/task6-diff-cache-comparison.json';
const body = Array.from({ length: 12000 }, (_, i) => `+const row_${i} = "${'payload '.repeat(6)}";`).join('\n');
const diff = 'diff --git a/src/large.ts b/src/large.ts\n--- a/src/large.ts\n+++ b/src/large.ts\n'
  + `@@ -0,0 +1,12000 @@\n${body}\n`;

async function load(version) {
  const result = await build({ entryPoints: ['shared/chat/turnPresentation.ts'], bundle: true,
    platform: 'node', format: 'esm', write: false, plugins: [{ name: 'count-line-parses', setup(builder) {
      builder.onLoad({ filter: /[\\/]shared[\\/]chat[\\/](diff|diffParser|turnPresentation)\.ts$/ }, args => {
        const path = args.path.slice(resolve('.').length + 1).replaceAll('\\', '/');
        let contents = version === 'baseline'
          ? execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' })
          : readFileSync(args.path, 'utf8');
        contents = contents.replace('const source = linesOf(raw);',
          'globalThis.__diffCacheBenchmarkParses++; const source = linesOf(raw);');
        return { contents, loader: 'ts' };
      });
    } }] });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const results = [];
for (const version of ['baseline', 'optimized']) {
  const { completedTurnFiles } = await load(version);
  for (const mode of ['net', 'fileChanges']) {
    globalThis.__diffCacheBenchmarkParses = 0;
    const started = performance.now();
    const lists = new WeakSet();
    let distinctFileLists = 0;
    for (let i = 0; i <= 100; i++) {
      const turn = { id: 'turn', status: 'inProgress', diff: mode === 'net' ? diff : '', items: [
        { id: 'edit', type: 'fileChange', status: 'completed', changes: [
          { path: 'src/large.ts', kind: { type: 'update' }, diff },
        ] }, { id: 'answer', type: 'agentMessage', text: `text delta ${i}` },
      ] };
      const files = completedTurnFiles(turn);
      if (!lists.has(files)) { lists.add(files); distinctFileLists++; }
    }
    results.push({ version, mode, bytes: Buffer.byteLength(diff), textUpdates: 100,
      parseLines: globalThis.__diffCacheBenchmarkParses, distinctFileLists,
      elapsedMs: +(performance.now() - started).toFixed(2) });
  }
}
mkdirSync('.codex-tmp', { recursive: true });
writeFileSync(output, JSON.stringify({ baseline, method: 'initial + 100 fresh snapshots, identical diff', results }, null, 2));
console.table(results);
console.log(output);
if (results.some(row => row.parseLines !== (row.version === 'baseline' ? 101 : 1))) process.exitCode = 1;
