# Government Engagement Dashboard — Setup & Handoff Brief

A self-contained dashboard for tracking engagements with **U.S. government**
officials (the cause is South Africa / South Africans), plus a complete brief
so a fresh Claude Code / Claude Desktop session can pick up the email-ingestion
work end-to-end without re-explaining anything.

---

## 0. Handoff TL;DR (read this first)

- **The dashboard is built and working** — `dashboard.html`. Open it in any
  browser. No build step, no server, no dependencies.
- **Data lives in the browser** (`localStorage`) and via JSON **Export/Import**.
  Nothing sensitive is committed to this repo.
- **The remaining work is data ingestion:** pull past/ongoing correspondence
  with U.S. officials out of email, turn it into the import JSON described in
  §4, and load it into the dashboard with **Import → Merge**.
- **Do the ingestion on Desktop / local Claude Code**, not the web session —
  that's where the Gmail accounts live and where the data can stay local
  (see §7).

If you are the Claude session picking this up: your job is §6.

---

## 1. What this is

`dashboard.html` — a companion to the existing Claude Bridge page
(`index.html`). Four tabs:

- **People** — searchable directory of officials (role, department, status,
  tags, contact details, notes).
- **Interactions** — a dated timeline per person, tagged by channel
  (Telegram / Email / Meeting / Call / WhatsApp), holding the context of each
  exchange.
- **Departments** — cards (mandate, "what we need", contacts, "feeds into")
  plus an auto-generated diagram of how departments connect.
- **Follow-ups** — a board (To do / In progress / Done) with priority, due
  dates, overdue flagging, linked to people and departments.
- **Overview** — live stats, an editable strategy note, upcoming/overdue
  follow-ups and recent interactions.

Global search spans names, roles, tags, notes **and interaction content**.

### Where the data lives

All data is stored **privately in the browser** (`localStorage`, key
`govDashboardData.v1`). Nothing is uploaded; nothing sensitive is committed.
Use **Export** (top-right) for a JSON backup, **Import** to restore/merge.
Keep a current export as backup — `localStorage` is per-browser.

---

## 2. Running it

Open `dashboard.html` in a browser (double-click a local copy, or serve the
repo statically like `index.html`). On first run, either **Add your first
contact** or **Load sample data to explore** (the sample uses clearly-fictional
`[Sample]` names in a U.S.-government context).

---

## 3. Accounts & the email dropbox

The engagements are with **U.S. government** officials. Correspondence is
consolidated by having people **forward** past threads and **BCC** future mail
to one address, which is then parsed into the dashboard.

### Candidate accounts

| Account | Notes |
|---------|-------|
| `usgovlog@gmail.com` | **Recommended** — a dedicated account created for this. Whole inbox = engagement bucket; no filter needed; no personal mail exposed. |
| `jamespaynter67@gmail.com` | Personal. Works, but a reader has access to the *entire* personal inbox; would need a filter and the alias `jamespaynter67+usgov@gmail.com`. |

> Note the correct spelling is **paynter** (with a "y").

### Message to send to contacts

> **Subject: Keeping our correspondence on file**
>
> Hi [Name],
>
> To make sure nothing we discuss slips through the cracks, I'm keeping all of
> our correspondence organised in one place.
>
> Two small asks:
> 1. Could you **forward our previous email threads** (the full thread, please —
>    not just the latest reply) to: **usgovlog@gmail.com**
> 2. Going forward, please **add that same address as a BCC** whenever you
>    email me.
>
> Thank you.

> **Why "the full thread"?** A forwarded email shows the *forwarder* as sender,
> not the official — the real participants live in the quoted body, so the whole
> thread must be included. BCCs on new mail are captured automatically.

### Which Gmail is a Claude session actually reading?

A Gmail connector binds to **one** account at a time. To confirm which, search
`in:sent` and read the sender address. (As of this writing, the *web* session's
Gmail connector was bound to `info@dynamicoutcomes.co.za` — not the dropbox — so
ingestion should run where the right account is connected; see §7.)

---

## 4. Import JSON schema (the contract)

`Import` accepts either a full export or a partial object with any of these
top-level arrays. **IDs are local to the file** — any unique string works; they
are remapped on import, and cross-references use these local IDs.

```jsonc
{
  "people": [
    {
      "id": "p1",                       // unique within this file
      "name": "Jane Official",          // REQUIRED
      "title": "Deputy Assistant Secretary",
      "org": "",                        // free-text office if no department
      "email": "jane@example.gov",
      "phone": "",
      "telegram": "@handle",
      "status": "active",               // "active" | "warm" | "cold"
      "tags": ["champion", "trade"],
      "notes": "Background, role in the goal, how we met…",
      "departmentId": "d1"              // -> departments[].id in THIS file, or null
    }
  ],
  "interactions": [
    {
      "id": "i1",
      "personId": "p1",                 // REQUIRED -> people[].id in THIS file
      "date": "2026-07-11",             // YYYY-MM-DD
      "channel": "Email",               // Telegram|Email|Meeting|Call|WhatsApp|Other
      "summary": "One-line what-happened",   // REQUIRED
      "detail": "Key quotes / pasted thread excerpt / what was agreed"
    }
  ],
  "departments": [
    {
      "id": "d1",
      "name": "U.S. Dept of State — African Affairs",   // REQUIRED
      "mandate": "What they do and why they matter",
      "whatWeNeed": "The ask / decision we're seeking",
      "feedsInto": ["d2"]               // -> other departments[].id in THIS file
    }
  ],
  "tasks": [
    {
      "id": "t1",
      "title": "Send one-page brief",   // REQUIRED
      "personId": "p1",                 // or null
      "departmentId": "d1",             // or null
      "priority": "High",               // "High" | "Medium" | "Low"
      "due": "2026-07-20",              // YYYY-MM-DD or null
      "status": "open"                  // "open" | "in-progress" | "done"
    }
  ],
  "mission": "Free-text strategy overview (optional)"
}
```

Minimum viable sync output is just `people` + `interactions` (with
`departmentId: null`); departments and tasks can be added later.

---

## 5. Merge vs Replace (import behavior)

- **Replace** wipes all current data and loads the file. Use for restoring a
  full backup.
- **Merge** (recommended for repeated syncs) adds new records and
  de-duplicates. Rules:
  - **Department** matched by `name` (case-insensitive).
  - **Person** matched by `email` if present, else by `name`.
  - **Interaction** deduped by `personId` + `date` + `summary`.
  - **Task** deduped by `title` + `personId`.
  - Existing **non-blank** fields are preserved; blanks are filled from the
    incoming record; **tags are unioned**.
  - `mission` is only taken if the dashboard has none.

This means you can run the same sync twice safely — nothing is double-counted.

---

## 6. Email ingestion — the task for the picking-up session

Goal: turn the dropbox mailbox into an `import.json` matching §4, then have the
user load it via **Import → Merge**.

**Steps:**

1. **Confirm the connected account.** Search `in:sent` and read the sender
   address. It must be the dropbox (`usgovlog@gmail.com`) or the agreed
   account. If it's the wrong one, stop and tell the user to rebind the Gmail
   connector (see §7).
2. **Find engagement threads.** The dropbox account: process everything in it.
   A shared personal account: constrain with search, e.g.
   `deliveredto:jamespaynter67+usgov@gmail.com`, or by known
   `.gov` / official domains, or by sender/subject as the user directs.
3. **Read each thread** (`get_thread`) and extract:
   - **Person**: the official's name, email, title/role, and which department
     or office they belong to. On a *forwarded* thread, the official is inside
     the quoted body, not the top-level `From`.
   - **Interaction(s)**: one per meaningful exchange — `date` (the message
     date, `YYYY-MM-DD`), `channel` (`Email` here), a one-line `summary`, and a
     `detail` with the key content/quotes.
4. **Build departments** as you encounter them (State, USAID, USTR, relevant
   Congressional committees/offices, NSC, Commerce, etc.), and set each
   person's `departmentId`. Set `feedsInto` where the relationships are clear.
5. **De-dupe within your output** (same person across threads = one `people`
   entry with multiple `interactions`).
6. **Write `import.json`** (schema §4). Locally, write the file and tell the
   user to Import it; if no filesystem, print the JSON for the user to paste
   into **Import → paste JSON → Merge**.
7. Optionally, label processed threads (e.g. an `Imported` label) so the next
   run only touches new mail.

**Cadence:** on demand ("sync the mailbox"), or a scheduled/local job. A
scheduled run needs the Gmail connection to stay authorized in the background —
verify before relying on it.

---

## 7. Web vs Desktop — where to run

- **Building the dashboard (code + git):** fine on Claude Code on the web —
  and already done. The code is portable and opens in any browser.
- **Running it + ingesting email:** better on **Desktop / local Claude Code**,
  because:
  - the relevant Gmail accounts are already connected there
    (`gmail-personal`, etc.);
  - data (dashboard file + contacts) can stay **local**, never touching a
    cloud/public surface — the right call for government-contact data;
  - it matches the local "Claude Bridge" pattern this repo is built around
    (localhost:3000 bridge to Notion/Obsidian/GHL/Sheets).

**In this web session, only the single `Web`-type Gmail connector is reachable;
the `Desktop`/`Local dev` connectors are not.** So do ingestion where the
correct account is connected — normally Desktop.

---

## 8. Planned enhancements (not yet built)

- **Passphrase lock** — optional encryption-at-rest for the `localStorage`
  data (Web Crypto AES-GCM + PBKDF2), with an "export first" safeguard. Left
  unbuilt deliberately to avoid shipping crypto that could lock the user out;
  implement carefully when needed.
- **Scheduled sync** — automatic recurring ingestion (depends on background
  Gmail auth staying valid).
- **Per-source labels** — mark imported threads to make syncs incremental.

---

## 9. Branch

Development branch: `claude/government-contacts-dashboard-0wya3i`.
Files: `dashboard.html` (the app), `SETUP.md` (this brief), `index.html`
(the pre-existing Claude Bridge proxy page).
