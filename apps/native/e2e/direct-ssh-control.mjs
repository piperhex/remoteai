// Supplies credentials for a disposable test SSH server; it never handles SSH traffic.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../../../.codex-tmp/direct-ssh/', import.meta.url));
const configPath = process.env.SSH_TEST_CONFIG;
if (!configPath) throw new Error('Set SSH_TEST_CONFIG to a disposable fixture configuration');
await mkdir(output, { recursive: true });
createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/config') {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    response.end(JSON.stringify({ ...config, host: '127.0.0.1', port: 22028 })); return;
  }
  if (request.url === '/result' && request.method === 'POST') {
    let text = '';
    for await (const chunk of request) { text += chunk; if (text.length > 4096) break; }
    const result = JSON.parse(text);
    await writeFile(`${output}/native-result.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    response.end('{}'); return;
  }
  response.writeHead(404).end('{}');
}).listen(15995, '127.0.0.1', () => console.log('Direct SSH test control ready'));
