#!/usr/bin/env node
/*
 * Claude Bridge - localhost API gateway.
 * Zero dependencies, Node 18+ (uses global fetch). Binds to 127.0.0.1 by default.
 * Configure via a .env file in this directory - see .env.example.
 *
 * Endpoints:
 *   GET  /api/status            health + which integrations are configured
 *   GET  /api/obsidian/notes    list .md files in the vault (?folder= ?limit=)
 *   GET  /api/obsidian/note     read one note (?path=)
 *   GET  /api/obsidian/search   substring search across notes (?q= ?limit=)
 *   GET  /api/filesystem/list   list a directory (?path=) within FS_ALLOWED_ROOTS
 *   ANY  /api/ghl/<path>        authenticated passthrough to the GoHighLevel API
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

if (typeof fetch !== 'function') {
  console.error('Claude Bridge needs Node 18+ (global fetch). Detected: ' + process.version);
  process.exit(1);
}

// --- minimal .env loader (no dependency) ---
function loadEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.join(__dirname, '.env'));

const CONFIG = {
  host: process.env.BRIDGE_HOST || '127.0.0.1',
  port: parseInt(process.env.BRIDGE_PORT || '3000', 10),
  token: process.env.BRIDGE_TOKEN || '',
  vault: process.env.OBSIDIAN_VAULT || '',
  fsRoots: (process.env.FS_ALLOWED_ROOTS || os.homedir())
    .split(',').map((s) => s.trim()).filter(Boolean),
  ghl: {
    base: (process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com')
      .replace(/\/+$/, ''),
    key: process.env.GHL_API_KEY || '',
    version: process.env.GHL_API_VERSION || '2021-07-28',
    locationId: process.env.GHL_LOCATION_ID || '',
  },
  origins: (process.env.ALLOWED_ORIGINS ||
    'http://localhost:3000,https://jimboky.github.io,null')
    .split(',').map((s) => s.trim()).filter(Boolean),
};

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);

// --- helpers ---
function corsHeaders(origin) {
  let allow;
  if (!origin) allow = '*';
  else if (CONFIG.origins.includes('*')) allow = origin;
  else if (CONFIG.origins.includes(origin)) allow = origin;
  else allow = CONFIG.origins[0] || 'null';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
  };
}

function sendJson(res, status, obj, cors) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(cors || {}),
  });
  res.end(JSON.stringify(obj, null, 2));
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function clampInt(value, def, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        reject(httpError(413, 'request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Resolve `rel` against an already-realpath'd root, refusing anything that
// escapes the root (blocks ../ traversal and symlink breakouts).
function resolveSafe(rootReal, rel) {
  const target = path.resolve(rootReal, rel || '.');
  let rp;
  try {
    rp = fs.realpathSync(target);
  } catch {
    throw httpError(404, 'path not found');
  }
  if (rp !== rootReal && !rp.startsWith(rootReal + path.sep)) {
    throw httpError(403, 'path escapes the allowed root');
  }
  return rp;
}

function requireVault() {
  if (!CONFIG.vault) {
    throw httpError(503, 'Obsidian not configured (set OBSIDIAN_VAULT)');
  }
  try {
    return fs.realpathSync(CONFIG.vault);
  } catch {
    throw httpError(503, 'OBSIDIAN_VAULT path does not exist: ' + CONFIG.vault);
  }
}

// --- handlers ---
function handleStatus(res, cors) {
  let vaultOk = false;
  try {
    vaultOk = !!CONFIG.vault && fs.statSync(CONFIG.vault).isDirectory();
  } catch { /* not configured / missing */ }
  sendJson(res, 200, {
    status: 'ok',
    service: 'claude-bridge',
    time: new Date().toISOString(),
    node: process.version,
    auth: CONFIG.token ? 'token-required' : 'open',
    integrations: {
      obsidian: vaultOk,
      ghl: !!CONFIG.ghl.key,
      filesystem: CONFIG.fsRoots.length > 0,
    },
  }, cors);
}

function handleObsidianNotes(url, res, cors) {
  const root = requireVault();
  const start = resolveSafe(root, url.searchParams.get('folder') || '');
  const limit = clampInt(url.searchParams.get('limit'), 500, 1, 5000);
  const notes = [];
  (function walk(dir) {
    if (notes.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (notes.length >= limit) return;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        notes.push({
          path: path.relative(root, full),
          size: st.size,
          modified: st.mtime.toISOString(),
        });
      }
    }
  })(start);
  notes.sort((a, b) => b.modified.localeCompare(a.modified));
  sendJson(res, 200, { vault: root, count: notes.length, limit, notes }, cors);
}

function handleObsidianNote(url, res, cors) {
  const root = requireVault();
  const rel = url.searchParams.get('path');
  if (!rel) throw httpError(400, 'missing ?path=');
  const target = resolveSafe(root, rel);
  const st = fs.statSync(target);
  if (!st.isFile()) throw httpError(400, 'not a file');
  if (st.size > 2 * 1024 * 1024) throw httpError(413, 'file too large (>2MB)');
  sendJson(res, 200, {
    path: path.relative(root, target),
    size: st.size,
    modified: st.mtime.toISOString(),
    content: fs.readFileSync(target, 'utf8'),
  }, cors);
}

function handleObsidianSearch(url, res, cors) {
  const root = requireVault();
  const query = (url.searchParams.get('q') || '').trim();
  if (!query) throw httpError(400, 'missing ?q=');
  const limit = clampInt(url.searchParams.get('limit'), 20, 1, 100);
  const needle = query.toLowerCase();
  const MAX_SCAN = 3000;
  const results = [];
  let scanned = 0;
  (function walk(dir) {
    if (results.length >= limit || scanned >= MAX_SCAN) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit || scanned >= MAX_SCAN) return;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      scanned++;
      let text;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const idx = text.toLowerCase().indexOf(needle);
      if (idx !== -1) {
        const from = Math.max(0, idx - 80);
        const snippet = text
          .slice(from, idx + needle.length + 80)
          .replace(/\s+/g, ' ')
          .trim();
        results.push({ path: path.relative(root, full), snippet });
      }
    }
  })(root);
  sendJson(res, 200, {
    query,
    count: results.length,
    scanned,
    truncated: scanned >= MAX_SCAN,
    results,
  }, cors);
}

function handleFsList(url, res, cors) {
  const reqPath = url.searchParams.get('path');
  if (!reqPath) throw httpError(400, 'missing ?path=');
  const roots = CONFIG.fsRoots
    .map((r) => {
      try {
        return fs.realpathSync(r);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (!roots.length) throw httpError(503, 'no valid FS_ALLOWED_ROOTS configured');
  let target;
  try {
    target = fs.realpathSync(path.resolve(reqPath));
  } catch {
    throw httpError(404, 'path not found');
  }
  const within = roots.some(
    (r) => target === r || target.startsWith(r + path.sep),
  );
  if (!within) throw httpError(403, 'path is outside FS_ALLOWED_ROOTS');
  if (!fs.statSync(target).isDirectory()) throw httpError(400, 'not a directory');
  const entries = fs.readdirSync(target, { withFileTypes: true }).map((entry) => {
    const full = path.join(target, entry.name);
    let size = null;
    let modified = null;
    try {
      const st = fs.statSync(full);
      size = st.size;
      modified = st.mtime.toISOString();
    } catch { /* broken symlink etc. */ }
    return {
      name: entry.name,
      type: entry.isDirectory()
        ? 'directory'
        : entry.isFile()
          ? 'file'
          : entry.isSymbolicLink()
            ? 'symlink'
            : 'other',
      size,
      modified,
    };
  });
  entries.sort((a, b) =>
    a.type === b.type
      ? a.name.localeCompare(b.name)
      : a.type === 'directory' ? -1 : 1,
  );
  sendJson(res, 200, { path: target, count: entries.length, entries }, cors);
}

async function handleGhl(req, url, res, cors, restPath) {
  if (!CONFIG.ghl.key) throw httpError(503, 'GHL not configured (set GHL_API_KEY)');
  const params = url.searchParams;
  params.delete('token');
  if (CONFIG.ghl.locationId && !params.has('locationId')) {
    params.set('locationId', CONFIG.ghl.locationId);
  }
  const qs = params.toString();
  const target = CONFIG.ghl.base + '/' + restPath + (qs ? '?' + qs : '');
  const headers = {
    Authorization: 'Bearer ' + CONFIG.ghl.key,
    Accept: 'application/json',
  };
  if (CONFIG.ghl.version) headers.Version = CONFIG.ghl.version;
  let body;
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    body = await readBody(req, 1024 * 1024);
    if (body.length) {
      headers['Content-Type'] = req.headers['content-type'] || 'application/json';
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body && body.length ? body : undefined,
      signal: controller.signal,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      ...cors,
    });
    res.end(text);
  } catch (e) {
    sendJson(res, 502, {
      error: 'GHL request failed',
      detail: e.name === 'AbortError' ? 'upstream timeout (20s)' : e.message,
    }, cors);
  } finally {
    clearTimeout(timer);
  }
}

const GET_ONLY = new Set([
  '/api/obsidian/notes',
  '/api/obsidian/note',
  '/api/obsidian/search',
  '/api/filesystem/list',
]);

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req.headers.origin || '');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendJson(res, 400, { error: 'malformed URL' }, cors);
  }
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  console.log(`${new Date().toISOString()}  ${req.method.padEnd(6)} ${pathname}`);

  try {
    if (pathname === '/' || pathname === '/api') {
      return sendJson(res, 200, {
        service: 'claude-bridge',
        hint: 'See GET /api/status',
      }, cors);
    }
    if (pathname === '/api/status') return handleStatus(res, cors);

    if (CONFIG.token) {
      const auth = req.headers.authorization || '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const queryToken = url.searchParams.get('token') || '';
      if (bearer !== CONFIG.token && queryToken !== CONFIG.token) {
        return sendJson(res, 401, { error: 'unauthorized' }, cors);
      }
    }

    if (GET_ONLY.has(pathname) && req.method !== 'GET') {
      return sendJson(res, 405, { error: 'method not allowed, use GET' }, cors);
    }

    if (pathname === '/api/obsidian/notes') return handleObsidianNotes(url, res, cors);
    if (pathname === '/api/obsidian/note') return handleObsidianNote(url, res, cors);
    if (pathname === '/api/obsidian/search') return handleObsidianSearch(url, res, cors);
    if (pathname === '/api/filesystem/list') return handleFsList(url, res, cors);
    if (pathname.startsWith('/api/ghl/')) {
      return await handleGhl(req, url, res, cors, pathname.slice('/api/ghl/'.length));
    }

    return sendJson(res, 404, { error: 'not found', path: pathname }, cors);
  } catch (e) {
    return sendJson(res, e.status || 500, { error: e.message }, cors);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${CONFIG.port} is already in use.`);
  } else {
    console.error('Server error:', e.message);
  }
  process.exit(1);
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`Claude Bridge listening on http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`  Obsidian vault : ${CONFIG.vault || '(not configured)'}`);
  console.log(`  GHL            : ${CONFIG.ghl.key ? CONFIG.ghl.base : '(not configured)'}`);
  console.log(`  FS roots       : ${CONFIG.fsRoots.join(', ') || '(none)'}`);
  console.log(`  Auth           : ${CONFIG.token ? 'token required' : 'open (localhost only)'}`);
});
