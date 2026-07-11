# Government Engagement Dashboard — Setup & Operating Guide

A running record of how the dashboard works, how contact/email data flows in,
and what to do next. Keep this file up to date as the setup evolves.

---

## 1. What this is

`dashboard.html` — a self-contained, single-page dashboard for tracking
engagements with government officials. It is a companion to the existing
Claude Bridge page (`index.html`) and can be served the same way.

It covers:

- **People** — searchable directory of officials (role, department, status,
  tags, contact details, notes).
- **Interactions** — a dated timeline per person, tagged by channel
  (Telegram / Email / Meeting / Call / WhatsApp), where the context from a
  chat or email is stored.
- **Departments** — cards (mandate, "what we need", contacts, "feeds into")
  plus an auto-generated diagram of how departments connect.
- **Follow-ups** — a board (To do / In progress / Done) with priority, due
  dates, overdue flagging, and links to people and departments.
- **Overview** — live stats, an editable strategy note, and upcoming/overdue
  follow-ups + recent interactions.

### Where the data lives

All data is stored **privately in the browser** (`localStorage`) — nothing is
uploaded, and nothing sensitive is committed to this repository. Use
**Export** (top-right) to download a JSON backup, and **Import** to restore it
or move it between devices/browsers.

> Because the data is per-browser, always keep a current exported backup.

---

## 2. Getting data in

Four routes, mix and match:

| Route | How it works | Effort |
|-------|--------------|--------|
| **Manual entry** | Add contacts/interactions directly in the UI. | Anytime, no setup |
| **Email dropbox** | People forward/BCC a dedicated address; it gets parsed in. | See §3 |
| **Telegram exports** | Telegram Desktop → chat → ⋯ → *Export chat history* → JSON → send the files to be parsed. | 5 min per batch |
| **Notion / GoHighLevel / Sheets** | Sync existing contact lists in via the Claude Bridge. | Depends on source |

The recommended split: bulk-import from email/Telegram, then add by hand the
people and off-the-record context (phone calls, meetings) that aren't written
down anywhere.

---

## 3. Email dropbox (forward + BCC)

### The address

**`james+gov@dynamicforexllc.com`**

This is a plus-alias on the connected Gmail account — it needs no admin setup
and delivers straight into the `james@dynamicforexllc.com` inbox. ("gov" can be
swapped for any word.) A cleaner dedicated address
(e.g. `engagements@dynamicforexllc.com`) can be created later in Google Admin
if preferred; the ingestion side is identical.

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
>    not just the latest reply) to: **james+gov@dynamicforexllc.com**
> 2. Going forward, please **add that same address as a BCC** whenever you
>    email me.
>
> That's it — nothing else changes, and it just helps me stay on top of
> follow-ups. Thank you.

> **Why "the full thread"?** A forwarded email shows the *forwarder* as sender,
> not the official. The real participants and history live in the quoted body,
> so the whole thread must be included for the parse to reconstruct who said
> what. BCCs on new mail are captured automatically.

### Gmail filter (one-time, ~1 minute)

Keeps this stream out of the main inbox and in a clean bucket:

1. Gmail → **Settings ⚙️ → See all settings → Filters and Blocked Addresses →
   Create a new filter**.
2. In **"Has the words"**, paste exactly:
   ```
   deliveredto:james+gov@dynamicforexllc.com
   ```
   (This reliably catches plus-aliased mail, **including BCCs**, which a plain
   "To" filter misses.)
3. **Create filter**, then tick:
   - ✅ Skip the Inbox (Archive it)
   - ✅ Apply the label → new label **`Gov-Engagement`**
   - ✅ Never send it to Spam
   - ✅ Also apply filter to matching conversations
4. **Create filter.**

---

## 4. Sync process (turning the mailbox into dashboard data)

A "sync" does the following:

1. Search `label:Gov-Engagement` for anything new since the last run.
2. Parse each thread → extract the official's name/email + a dated summary of
   what was discussed.
3. Dedupe against existing dashboard contacts (by name/email).
4. Apply an `Imported` sub-label to each processed thread so nothing is counted
   twice.
5. Produce an `import.json` to load into the dashboard via **Import**.

**Cadence options:**
- **On demand** — trigger a sync when you want ("sync the mailbox").
- **Scheduled** — an automatic recurring sync. Caveat: background/scheduled
  runs need the Gmail connection to stay authorized; to be tested before
  relying on it.

**Planned improvements:**
- Optional passphrase-lock on the dashboard data.
- "Merge import" mode (adds to existing data with de-duplication, instead of
  replacing).

---

## 5. Test before rollout

Before asking any officials to forward mail:

1. Forward **one real thread** to `james+gov@dynamicforexllc.com`.
2. Run a sync.
3. Review the contact + interaction it produces in the dashboard, and confirm
   the parse quality.

Only roll the request out to contacts once that test looks right.

---

## 6. Hosting

Current: served as a static page from this repo (like `index.html`), with all
data browser-local. The **page** being public is harmless — it is an empty
shell; the sensitive part (the data) never leaves the browser. Recommended
addition: the passphrase-lock above. A fully local-only option (open the file
directly, never publish) is available if preferred, at the cost of the
convenient URL.

---

## 7. Branch

Development branch: `claude/government-contacts-dashboard-0wya3i`.
