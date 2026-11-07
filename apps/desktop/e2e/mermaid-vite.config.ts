import { execFileSync } from 'node:child_process';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import desktopConfig from '../scripts/vite.config';

function baselineMeasurement(): Plugin {
  return { name: 'mermaid-baseline-measurement', enforce: 'pre', transform(source, id) {
    if (process.env.MERMAID_BASELINE !== '1') return;
    const name = id.endsWith('/shared/chat/MermaidDiagram.tsx') ? 'MermaidDiagram.tsx'
      : id.endsWith('/shared/chat/mermaidRenderer.ts') ? 'mermaidRenderer.ts' : undefined;
    if (!name) return;
    // Restore only the two original modules in the test server; never rewrite the shared working tree.
    source = execFileSync('git', ['show', `04776426e:shared/chat/${name}`], { encoding: 'utf8' });
    if (name === 'MermaidDiagram.tsx') return source;
    source = source.replace('const result = pending.then(async () => {',
      'baselineCounts.requests++; const result = pending.then(async () => {');
    source = source.replace('return await mermaid.render(id, source, container);',
      'baselineCounts.layouts++; return await mermaid.render(id, source, container);');
    return 'const baselineCounts = { requests: 0, layouts: 0, cacheHits: 0 };\n'
      + 'export function mermaidRenderStats() { return { ...baselineCounts }; }\n' + source;
  } };
}

// Keep this regression fixture's dependency scan/cache independent from other running app fixtures.
export default mergeConfig(desktopConfig, defineConfig({
  plugins: [baselineMeasurement()],
  cacheDir: '../../.codex-tmp/mermaid-vite-cache',
  optimizeDeps: { entries: ['e2e/mermaid-harness.html'] },
  // Freeze the fixture during measurements, and avoid watching native build artifacts on Windows.
  server: { watch: { ignored: ['**/*'] }, hmr: false },
}));
