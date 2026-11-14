import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Record<string, string>) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const path = Buffer.from(`dist/${name}`), data = Buffer.from(text);
    const entry = Buffer.alloc(30), directory = Buffer.alloc(46);
    entry.writeUInt32LE(0x04034b50); entry.writeUInt16LE(20, 4);
    entry.writeUInt32LE(crc32(data), 14); entry.writeUInt32LE(data.length, 18);
    entry.writeUInt32LE(data.length, 22); entry.writeUInt16LE(path.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc32(data), 16); directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(path.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(entry, path, data); central.push(directory, path); offset += entry.length + path.length + data.length;
  }
  const end = Buffer.alloc(22), directory = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export async function homeArchive(version: string) {
  const compiled = await build({ stdin: { loader: 'jsx', resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    function Home(){const [count,setCount]=React.useState(0);return <main><small>REMOTE AI · HOME</small>
      <h1>自定义首页 ${version}</h1><p>从这里开始，打开你的工作空间。</p>
      <button onClick={()=>setCount(count+1)}>已点击 {count} 次</button>
      <a href="https://home.example.test/">打开工作空间</a><img src="/logo.svg"/></main>}
    createRoot(document.getElementById('root')).render(<Home/>);` },
    bundle: true, write: false, format: 'esm', define: { 'process.env.NODE_ENV': '"production"' } });
  return zip({
    'index.html': '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/assets/app.css">'
      + '<script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>',
    'assets/app.js': `import './chunk.js';\n${compiled.outputFiles[0].text}\n`
      + `window.loadHomeChunk = () => import('./lazy.js');`,
    'assets/chunk.js': `import { label } from './cycle.js'; document.body.dataset.chunk = label; export const ready = true;`,
    'assets/cycle.js': `import { ready } from './chunk.js'; export const label = 'ready'; export const check = () => ready;`,
    'assets/lazy.js': `export const value = 'lazy-ready';`,
    'assets/app.css': 'body{margin:0;background:#edf7f4;color:#163d35;font-family:system-ui}main{padding:72px}'
      + 'h1{font-size:38px;margin:20px 0}p{color:#57766e}button,a{display:inline-block;margin:24px 18px 0 0;'
      + 'padding:12px 20px;background:#0c7b66;color:white;border:0;border-radius:12px;text-decoration:none;font:inherit}'
      + 'img{display:block;width:80px;height:80px;margin-top:48px}',
    'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="20" '
      + 'fill="#0c7b66"/><path d="M20 40h40M40 20v40" stroke="white" stroke-width="6"/></svg>',
  });
}
