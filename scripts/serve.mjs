#!/usr/bin/env node
// خادم ملفات ثابتة بسيط للتطوير المحلي (بدون أي اعتماديات).
//   node scripts/serve.mjs            → http://localhost:5173
//   PORT=8080 node scripts/serve.mjs
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// لا تُخدم ملفات الخادم/الأسرار حتى محليًا.
const BLOCKED = [/^\/\.env/, /^\/supabase\//, /^\/node_modules\//, /^\/tests\//, /^\/scripts\//, /^\/\.git/];

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (BLOCKED.some((re) => re.test(pathname))) { res.writeHead(404).end('Not found'); return; }
    let filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root + sep) && filePath !== root) { res.writeHead(403).end(); return; }
    let info = await stat(filePath).catch(() => null);
    if (info && info.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return; }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(body);
  } catch {
    res.writeHead(500).end('Server error');
  }
}).listen(port, host, () => console.log(`Serving ${root} at http://${host}:${port}`));
