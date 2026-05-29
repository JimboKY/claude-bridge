# Security Guide — Claude Bridge

This repo contains the **client** (`index.html`), a page that is hosted publicly
(e.g. GitHub Pages) and talks to a **bridge server** running on
`http://localhost:3000`. The bridge exposes powerful capabilities — the local
filesystem plus authenticated access to Notion, GoHighLevel, Google Sheets, and
Obsidian.

Because a publicly reachable page drives a privileged local server, **the
security of this system lives almost entirely in the bridge server.** The client
hardening shipped in `index.html` (token header, no hardcoded paths) only helps
if the server enforces the controls below.

## Threat model

Any web page open in your browser — not just this one — can attempt to send
requests to `http://localhost:3000` while the bridge is running. If the server
trusts requests based only on their origin, attackers can defeat that with
**DNS rebinding**. The consequences of a permissive bridge are severe: arbitrary
local file reads and full access to your connected SaaS accounts and their
tokens.

## Required server-side controls

### 1. Require an auth token on every request
Generate a long random token, give it to the user once, and reject any request
that doesn't present it. The client already sends it as `Authorization: Bearer <token>`.

```js
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN; // long random secret, set in env

app.use((req, res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Constant-time compare to avoid timing leaks.
  const ok = token.length === BRIDGE_TOKEN.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(BRIDGE_TOKEN));
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  next();
});
```

### 2. Restrict CORS to one origin — never `*`
Allow only the exact page origin. Do **not** reflect arbitrary origins and do
**not** use `Access-Control-Allow-Origin: *`.

```js
const ALLOWED_ORIGIN = 'https://YOUR-USERNAME.github.io'; // the page's origin

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin === ALLOWED_ORIGIN) {
    res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

### 3. Block DNS rebinding by validating the Host header
CORS alone is not enough — validate that requests are actually addressed to
localhost so an attacker-controlled domain rebound to `127.0.0.1` is rejected.

```js
const ALLOWED_HOSTS = new Set(['localhost:3000', '127.0.0.1:3000']);
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(req.get('host'))) {
    return res.status(403).json({ error: 'invalid host' });
  }
  next();
});
```

### 4. Allow-list filesystem paths
The `/api/filesystem/*` endpoints must confine access to an explicit root and
reject path traversal. Never serve an attacker-supplied absolute path.

```js
const path = require('path');
const ROOT = path.resolve(process.env.BRIDGE_FS_ROOT); // e.g. a dedicated shared dir

function safePath(userPath) {
  const resolved = path.resolve(ROOT, userPath);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    throw new Error('path outside allowed root');
  }
  return resolved;
}
```

### 5. Bind to loopback only
Start the server on `127.0.0.1` so it is never exposed on the LAN/Wi-Fi:

```js
app.listen(3000, '127.0.0.1');
```

## Additional recommendations
- Keep API tokens (Notion, GHL, Google, etc.) in environment variables, never in
  source or the client.
- Add rate limiting and request logging on the bridge.
- Consider scoping each downstream integration to least privilege.
- The client serves over HTTPS but calls `http://localhost` — this mixed-content
  request is expected and is the safest option (localhost is treated as a secure
  context by browsers); do not "fix" it by exposing the bridge over plain HTTP on
  a public address.

## Client controls already in place (`index.html`)
- Sends `Authorization: Bearer <token>` on every request (token entered by user,
  stored only in `sessionStorage` for the tab).
- No hardcoded personal filesystem paths.
- Renders responses via `textContent` (no HTML injection).
