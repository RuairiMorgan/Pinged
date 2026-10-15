import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilePollStore } from './polling.mjs';
import { createPingService } from './service.mjs';

const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
async function body(req) {
  if (req.headers['content-type'] !== 'application/json') throw Object.assign(new Error('JSON required'), { status: 415 });
  let size = 0, text = '';
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw Object.assign(new Error('Request too large'), { status: 413 });
    text += chunk.toString('utf8');
  }
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

export function createApiServer({ service, dist = resolve('dist'), allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'] } = {}) {
  if (!service) throw new Error('Service required');
  return createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(?:localhost|127\.0\.0\.1):\d+$/.test(host)) return json(res, 403, { error: 'Local access only' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}` && !allowedOrigins.includes(origin)) return json(res, 403, { error: 'Origin not allowed' });
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        // Custom header blocks browser cross-site simple requests; no CORS permission is granted.
        if (req.headers['x-pinged-client'] !== '1') return json(res, 403, { error: 'Pinged client required' });
        if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, await service.snapshot());
        if (req.method === 'POST' && url.pathname === '/api/pings') return json(res, 201, await service.create(await body(req)));
        const match = url.pathname.match(/^\/api\/pings\/([a-zA-Z0-9-]+)(?:\/(feedback))?$/);
        if (match && req.method === 'PATCH' && !match[2]) return json(res, 200, await service.setEnabled(match[1], (await body(req))?.enabled));
        if (match && req.method === 'DELETE' && !match[2]) { await service.remove(match[1]); return json(res, 200, { ok: true }); }
        if (match && req.method === 'POST' && match[2]) { const input = await body(req); await service.feedback(match[1], input?.itemId, input?.value); return json(res, 200, { ok: true }); }
        return json(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const path = resolve(dist, '.' + pathname);
      if (!path.startsWith(dist + '/')) return json(res, 404, { error: 'Not found' });
      let data;
      try { data = await readFile(path); } catch { return json(res, 404, { error: 'Build the dashboard with npm run build first.' }); }
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(data);
    } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : 'Could not complete this action. Your existing data has been kept.' }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const service = createPingService({ store: new FilePollStore(resolve('data/pinged.json')) });
  const server = createApiServer({ service });
  server.listen(8787, '127.0.0.1', () => {
    console.log('Pinged local preview: http://127.0.0.1:8787');
    void service.runDue().catch(() => console.error('Scheduled check failed; retained prior state.'));
  });
  const timer = setInterval(() => { void service.runDue().catch(() => console.error('Scheduled check failed; retained prior state.')); }, 30_000);
  timer.unref();
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { clearInterval(timer); server.close(); });
}
