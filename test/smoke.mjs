/*
 * Smoke test for the Claude Bridge server.
 * Boots server.js against a throwaway vault and asserts each endpoint
 * behaves - including the path-traversal guards and the token gate.
 * Zero dependencies; run with `npm test`. Exits non-zero on any failure.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}`);
  }
}

function startServer(env) {
  return spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitForStatus(base, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + '/api/status');
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server at ${base} did not start within ${timeoutMs}ms`);
}

async function req(url, opts) {
  const r = await fetch(url, opts);
  let json = null;
  try {
    json = await r.json();
  } catch { /* non-JSON body */ }
  return { status: r.status, json };
}

const vault = mkdtempSync(join(tmpdir(), 'cb-vault-'));
mkdirSync(join(vault, 'Daily'));
writeFileSync(join(vault, 'Welcome.md'), '# Welcome\nThis note mentions USDZAR and backtesting.\n');
writeFileSync(join(vault, 'Daily', 'log.md'), '# Log\nGHL migration in progress.\n');

const servers = [];
function cleanup() {
  for (const s of servers) {
    try { s.kill('SIGTERM'); } catch { /* already exited */ }
  }
  try { rmSync(vault, { recursive: true, force: true }); } catch { /* best effort */ }
}

try {
  const base1 = 'http://127.0.0.1:3199';
  servers.push(startServer({
    BRIDGE_PORT: '3199',
    OBSIDIAN_VAULT: vault,
    FS_ALLOWED_ROOTS: tmpdir(),
    GHL_API_KEY: '',
  }));
  await waitForStatus(base1);

  console.log('open server:');
  let res = await req(`${base1}/api/status`);
  check('status 200', res.status === 200);
  check('status reports obsidian configured', res.json?.integrations?.obsidian === true);
  check('status reports filesystem configured', res.json?.integrations?.filesystem === true);

  res = await req(`${base1}/api/obsidian/notes`);
  check('obsidian notes 200', res.status === 200);
  check('obsidian notes finds 2 files', res.json?.count === 2);

  res = await req(`${base1}/api/obsidian/note?path=Welcome.md`);
  check('obsidian note 200', res.status === 200);
  check('obsidian note returns content',
    typeof res.json?.content === 'string' && res.json.content.includes('USDZAR'));

  res = await req(`${base1}/api/obsidian/search?q=USDZAR`);
  check('obsidian search 200', res.status === 200);
  check('obsidian search finds match', res.json?.count === 1);

  res = await req(`${base1}/api/obsidian/note?path=${encodeURIComponent('../../etc/passwd')}`);
  check('obsidian traversal blocked (403)', res.status === 403);

  res = await req(`${base1}/api/obsidian/note?path=${encodeURIComponent('../../../../../../nope/escape.md')}`);
  check('obsidian traversal to non-existent path blocked (403)', res.status === 403);

  res = await req(`${base1}/api/filesystem/list?path=${encodeURIComponent(vault)}`);
  check('filesystem list within root 200', res.status === 200);

  res = await req(`${base1}/api/filesystem/list?path=${encodeURIComponent('/etc')}`);
  check('filesystem list outside root blocked (403)', res.status === 403);

  res = await req(`${base1}/api/ghl/contacts`);
  check('ghl unconfigured returns 503', res.status === 503);

  res = await req(`${base1}/api/nope`);
  check('unknown route 404', res.status === 404);

  const base2 = 'http://127.0.0.1:3198';
  servers.push(startServer({
    BRIDGE_PORT: '3198',
    OBSIDIAN_VAULT: vault,
    BRIDGE_TOKEN: 'testtoken',
  }));
  await waitForStatus(base2);

  console.log('token-gated server:');
  res = await req(`${base2}/api/status`);
  check('status reachable without token', res.status === 200);

  res = await req(`${base2}/api/obsidian/notes`);
  check('notes without token rejected (401)', res.status === 401);

  res = await req(`${base2}/api/obsidian/notes`, { headers: { Authorization: 'Bearer testtoken' } });
  check('notes with token allowed (200)', res.status === 200);
} catch (e) {
  failed++;
  console.error('  FAIL harness error:', e.message);
} finally {
  cleanup();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
