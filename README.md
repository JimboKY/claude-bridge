# Claude Bridge

A small localhost HTTP server that exposes your Obsidian vault, GoHighLevel
account and parts of the filesystem behind a uniform `/api/*` surface. The
bridge is the **data plane**; Claude (or any HTTP client) is the brain on top.

The matching `index.html` is a thin proxy page - dropdowns and quick actions
that hit the bridge and show the JSON back.

---

## Verified state

| Piece                   | Status                                                    |
|-------------------------|-----------------------------------------------------------|
| Bridge server           | Working, Node 18+ (developed on Node 24)                  |
| Obsidian endpoints      | Verified against the real `ZenithPro-Memory` vault        |
| GoHighLevel endpoints   | Verified via the v1 REST API with a Keychain-backed key   |
| Filesystem endpoint     | Verified                                                  |
| Smoke test              | 18/18, runs in CI on Node 18 / 20 / 22                    |
| Localhost auth          | Open by default; optional `BRIDGE_TOKEN` bearer gate      |
| Remote / phone access   | **Not enabled** - parked behind a security review         |

---

## Usage modes

### 1. Local (Mac, today)

In the repo:

```bash
npm run start:mac
```

That loads `GHL_API_KEY` from macOS Keychain (entry name `claude-bridge-ghl-key`)
and starts the server on `http://127.0.0.1:3000`. Leave the tab open. Then:

- Open `index.html` directly in a browser - the quick actions and dropdown hit
  the bridge.
- Or `curl http://localhost:3000/api/<endpoint>` from another terminal.
- Or paste curl output into a Claude chat for analysis.

### 2. Dashboard (any browser, same Mac)

The proxy page is also hosted at <https://jimboky.github.io/claude-bridge/>.
Same UI; the JS still calls `http://localhost:3000`, so it only works when
opened **on the Mac running the bridge**. Bookmark it as a control panel.

### 3. Phone / tablet / anywhere - NOT YET ENABLED

The bridge binds to `127.0.0.1`, so nothing outside the Mac can reach it.
Enabling remote access requires, in order:

1. **Install Tailscale** on the Mac and each remote device. This gives every
   device a stable address on a private encrypted overlay (e.g.
   `mac.tail-XXXXX.ts.net`) without opening any router ports.
2. **Open the bind address** - change `.env` to `BRIDGE_HOST=0.0.0.0` so the
   server accepts connections beyond loopback. Tailscale's ACLs keep the
   wider internet out.
3. **Set `BRIDGE_TOKEN`** in `.env` to a strong random string. Every `/api/*`
   call except `/api/status` will then require
   `Authorization: Bearer <token>`. This is the only line of defence if
   Tailscale itself is breached, so don't skip it.
4. **Put HTTPS in front of the bridge** with Tailscale Serve. Browsers block
   mixed content from the HTTPS GitHub Pages page to a plain HTTP backend.
   Tailscale Serve gives a valid certificate at
   `https://mac.tail-XXXXX.ts.net/`.
5. **Point the page at the new URL** - change the `BRIDGE_URL` constant near
   the top of `index.html` (or add a settings field so it can be flipped per
   device).

**This whole path is parked** until a security review of `server.js` -
moving from "localhost only" to "reachable on an overlay network" is the step
that changes the threat model, and we agreed it was non-trivial. The current
code is the right thing to review.

---

## Endpoints

| Method | Path                                       | Notes                                        |
|--------|--------------------------------------------|----------------------------------------------|
| GET    | `/api/status`                              | Health + which integrations are configured.  |
| GET    | `/api/obsidian/notes`                      | `?folder=` `?limit=` (default 500, max 5000) |
| GET    | `/api/obsidian/note?path=`                 | Read one note (UTF-8, max 2 MB)              |
| GET    | `/api/obsidian/search?q=`                  | Substring search across `.md` files          |
| GET    | `/api/filesystem/list?path=`               | Must resolve inside `FS_ALLOWED_ROOTS`       |
| ANY    | `/api/ghl/<rest>`                          | Authenticated passthrough to GoHighLevel     |

`/api/ghl/<rest>` forwards to `${GHL_BASE_URL}/<rest>` with the API key as a
bearer header. `GHL_LOCATION_ID` is auto-appended as `?locationId=` when not
already set (handy for v2; harmless on v1).

---

## Security model

- **Loopback only** by default (`BRIDGE_HOST=127.0.0.1`).
- **Path traversal** is rejected lexically *before* any filesystem access -
  `../` escapes return `403` regardless of whether the target exists, on any
  OS. A symlink containment check still runs after `realpath` resolution to
  catch symlink breakouts.
- **CORS** is an explicit allowlist (see `ALLOWED_ORIGINS`). Unknown origins
  fall back to the first configured origin rather than echoing.
- **GHL key** belongs in macOS Keychain, not `.env`. `.gitignore` blocks
  `.env` from being committed, but Keychain is one layer better.
- **`BRIDGE_TOKEN`** gates every `/api/*` route except `/api/status` when
  set. Required before any non-localhost exposure.

---

## Mac specifics

**Storing the GHL key in Keychain** (one-time, after rotating the key):

```bash
# Copy the new key to the clipboard first (Cmd+C in the GHL UI).
security add-generic-password \
  -U \
  -a "$USER" \
  -s claude-bridge-ghl-key \
  -j "GHL API key for claude-bridge" \
  -w "$(pbpaste)"

# Verify length looks right (full JWT is ~200+ chars):
security find-generic-password -s claude-bridge-ghl-key -w | wc -c
```

**Don't** use the interactive `-w` (no value) prompt - it truncates at ~128
characters and silently corrupts long JWTs.

**Keeping the Mac awake** so the bridge stays reachable:

```bash
caffeinate -i npm run start:mac   # prevents idle sleep while this runs
```

Or System Settings → Lock Screen → "Prevent automatic sleeping when display
is off" for a more permanent setup.

---

## Known limitations

- **Claude on the web cannot call the bridge directly.** You have to paste
  curl output or screenshots back into the chat. Claude Code with an MCP
  wrapper around these endpoints would change that - future work.
- **`/api/ghl/<rest>` is a thin passthrough.** It doesn't normalise paths
  between v1 and v2. The named endpoints in the dropdown assume v1 paths;
  for v2 calls use the page's "Custom endpoint" field with the full path.
- **The dashboard page is a generic API caller**, not a purpose-built UI.
  Things like "leads today" or "vault notes touching X" would each be a small
  view to add.

---

## Config reference

See `.env.example` for every variable, including a recommended Keychain
recipe at the bottom of the GHL section.
