import { mkdirSync, openSync, closeSync, writeSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { editorService } from './client.mjs';

const root = resolve(import.meta.dirname, '../..');
const evidence = resolve(root, '.codex-tmp/project-editor');
const mode = process.argv[2];

function peak(pid) {
  const command = `$p=Get-Process -Id ${pid}; @{workingSet=$p.WorkingSet64;peakWorkingSet=$p.PeakWorkingSet64;privateBytes=$p.PrivateMemorySize64} | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true }));
}

if (mode === 'before' || mode === 'after') {
  const file = process.argv[3];
  const service = editorService(resolve(evidence, `${mode}.exe`));
  const frontend = await import(pathToFileURL(resolve(evidence, `${mode}-frontend.mjs`)).href);
  const smallRoot = resolve(evidence, 'other-project');
  const smallTarget = { cwd: smallRoot, path: 'small.txt' };
  const original = await service.request({ operation: 'projectFileRead', ...smallTarget });
  const nodeStart = process.memoryUsage();
  const hostStart = peak(service.child.pid);
  let transportBytes = 0;
  let calls = 0;
  const stages = [];
  const request = async input => {
    calls += 1;
    const reply = await service.request(input);
    transportBytes += Buffer.byteLength(JSON.stringify(reply.data));
    if (calls <= 2) stages.push({ operation: input.operation, ms: reply.ms });
    return reply.data;
  };
  const start = performance.now();
  const opening = frontend.readProjectDocument(request, { cwd: resolve(file, '..'), path: file });
  await new Promise(resolve => setTimeout(resolve, 10));
  const parallelRead = service.request({ operation: 'projectFileRead', cwd: smallRoot, path: 'read.txt' });
  const parallelWrite = service.request({ operation: 'projectFileWrite', ...smallTarget,
    revision: original.data.revision, text: 'small update' });
  const document = await opening;
  const textReadyMs = performance.now() - start;
  const [read, write] = await Promise.all([parallelRead, parallelWrite]);
  const nodeEnd = process.memoryUsage();
  const hostPeak = peak(service.child.pid);
  const nodePeak = peak(process.pid);
  let nextPageMs;
  let saveMs;
  let saveParallelReadMs;
  let saveParallelWriteMs;
  let hostSavePeak;
  if (document.window) {
    const next = await service.request({ operation: 'projectFileRead', cwd: resolve(file, '..'), path: file,
      window: { token: document.window.token, offset: document.window.end } });
    nextPageMs = next.ms;
    const saving = service.request({ operation: 'projectFileWrite', cwd: resolve(file, '..'), path: file,
      window: document.window, revision: document.revision, text: document.text });
    await new Promise(resolve => setTimeout(resolve, 10));
    const duringSave = await Promise.all([
      service.request({ operation: 'projectFileRead', cwd: smallRoot, path: 'read.txt' }),
      service.request({ operation: 'projectFileWrite', ...smallTarget,
        revision: write.data.revision, text: 'small update' }),
    ]);
    const saved = await saving;
    saveMs = saved.ms;
    saveParallelReadMs = duringSave[0].ms;
    saveParallelWriteMs = duringSave[1].ms;
    hostSavePeak = peak(service.child.pid);
    await service.request({ operation: 'projectFileRead', cwd: resolve(file, '..'), path: file,
      window: { token: document.window.token, cancel: true } });
  }
  const result = { mode, size: document.size, textBytes: Buffer.byteLength(document.text ?? ''),
    textReadyMs, nextPageMs, saveMs, saveParallelReadMs, saveParallelWriteMs, hostSavePeak,
    stages, parallelReadMs: read.ms, parallelWriteMs: write.ms,
    transportBytes, calls, nodeStart, nodeEnd, nodePeak, hostStart, hostPeak,
    snapshotDiskBytes: document.window ? document.size : 0,
    maximumSaveExtraDiskBytes: document.window ? document.size * 3 : 0 };
  service.close();
  process.stdout.write(JSON.stringify(result) + '\n');
} else {
  mkdirSync(evidence, { recursive: true });
  const oldRoot = resolve(evidence, 'frontend-baseline/shared');
  mkdirSync(resolve(oldRoot, 'project-browser'), { recursive: true });
  mkdirSync(resolve(oldRoot, 'remote-chat'), { recursive: true });
  writeFileSync(resolve(oldRoot, 'project-browser/fileTransfer.ts'), execFileSync('git',
    ['show', '04776426e:shared/project-browser/fileTransfer.ts'], { cwd: root }));
  writeFileSync(resolve(oldRoot, 'project-browser/protocol.ts'), 'export const PROJECT_FILE_CHUNK_BYTES = 256 * 1024;\n');
  writeFileSync(resolve(oldRoot, 'remote-chat/utf8.ts'), readFileSync(resolve(root, 'shared/remote-chat/utf8.ts')));
  for (const version of ['before', 'after']) {
    await build({ entryPoints: [version === 'before' ? resolve(oldRoot, 'project-browser/fileTransfer.ts')
      : resolve(root, 'shared/project-browser/fileTransfer.ts')], bundle: true, platform: 'node', format: 'esm',
    outfile: resolve(evidence, `${version}-frontend.mjs`) });
  }
  const smallRoot = resolve(evidence, 'other-project');
  mkdirSync(smallRoot, { recursive: true });
  writeFileSync(resolve(smallRoot, 'small.txt'), 'small update');
  writeFileSync(resolve(smallRoot, 'read.txt'), 'read another project');
  const samples = [];
  const line = Buffer.from('2026-11-01 INFO request=01234567 中文🙂 reproducible log entry\r\n');
  for (const mib of [128, 256]) {
    const directory = resolve(evidence, `project-${mib}`);
    mkdirSync(directory, { recursive: true });
    const file = resolve(directory, 'large.log');
    const output = openSync(file, 'w');
    const block = Buffer.concat(Array(1024).fill(line));
    const blocks = Math.ceil(mib * 1024 * 1024 / block.length);
    for (let index = 0; index < blocks; index += 1) writeSync(output, block);
    closeSync(output);
    for (let repeat = 0; repeat < 3; repeat += 1) {
      for (const version of ['before', 'after']) {
        const result = spawnSync(process.execPath, [import.meta.filename, version, file],
          { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        if (result.status !== 0) throw new Error(result.stderr);
        const sample = { repeat, ...JSON.parse(result.stdout.trim()) };
        samples.push(sample);
        writeFileSync(resolve(evidence, 'measurements.json'), JSON.stringify(samples, null, 2));
        process.stdout.write(`${version} ${mib} MiB #${repeat}: ready ${sample.textReadyMs.toFixed(1)}ms; host peak ${(sample.hostPeak.peakWorkingSet / 1024 ** 2).toFixed(1)} MiB; frontend peak ${(sample.nodePeak.peakWorkingSet / 1024 ** 2).toFixed(1)} MiB\n`);
      }
    }
  }
}
