import http from 'node:http';
import { chromium } from '@playwright/test';

// Test-only loopback transport: exercise the real native browser behind the remote preview surface.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find(page => page.url().includes('website-tabs-harness'));
if (!page) throw new Error('Native test window missing');
http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:1552');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.method !== 'POST' || request.url !== '/request') { response.writeHead(404); response.end(); return; }
  try {
    let body = '';
    for await (const chunk of request) { body += chunk; if (body.length > 32000) throw new Error('Request too large'); }
    const result = await page.evaluate(request => window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request }),
      JSON.parse(body));
    response.end(JSON.stringify(result));
  } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: error.message })); }
}).listen(1554, '127.0.0.1');
