# Spend credits

Source: https://kensaur.us/mushi-mushi/docs/admin/credits

---
title: Spend credits
description: The console Spend credits page lists expiring Cursor and Firecrawl credits and puts every way Mushi can spend them on finding and fixing bugs behind one switch each.
---

# Spend credits

**Route:** `/credits`

Cursor and Firecrawl credits that lapse at the end of a period are worth more spent on your apps. This page shows when each key's credits expire and lists every place Mushi can spend them, with a switch for each. The full form behind each switch stays where it was (Settings → AI keys, Settings → Web tools, Inventory → Discovery); this page answers one question: is anything spending them, and on what?

## Cursor: fix bugs

Each Cursor key shows its hint, label and expiry ("expires Oct 28 (6 days)").

- **Fix open bugs before the credits expire** turns [spend-down](../concepts/agent-pr-review#spend-down-and-its-safety-stop) on or off for that key. While it is on, Mushi sends your best open reports to Cursor on its own, inside each app's auto-fix limits, and every fix opens a draft pull request. The switch is off until the key has an expiry date; set it in Settings → AI keys. A key your organization shares can be changed by an owner or admin, and someone else's universal key only by its owner.
- When every app has nothing left to send, the row says so. Watching more of your live sites (below) is the way to find more.
- **Review follow-ups** sends a pull request the Opus review marked "fix first" back to a new Cursor agent with the review's findings, at most twice per pull request and never on a "hold". The line names the model each round uses; when a **Last round model** is set in Settings → AI keys, the second round, which only happens after the first did not satisfy the reviewer, runs on it (for example Opus while the first stays on Grok).

## Firecrawl: find bugs on your live sites

The first line is the Firecrawl balance and when it resets. Unused credits do not roll over. The next line is the pace: what the site watches use a day, what that comes to before the reset, and what would go unused at that pace.

Each app has a row:

- **Watch the live site daily** turns its [live-site watch](./inventory) on or off. Turning it on uses the address shown, the app's suggested address, or one you type, at 25 pages a check. Turning it off asks first, then deletes the Firecrawl monitor; reports it already filed stay.
- **Watch up to 100 pages** appears when a watch reads fewer pages than one check allows.
- An app with no Firecrawl key it can use says so. Add a key, or share yours with all your apps, in Settings → Web tools.

A broken page becomes a bug report only after a second check confirms it, and spend-down can then send it to Cursor.

## Where the fixes go

Fixes these levers open are on [Fixes](./fixes). The **Opus: merge** filter there lists the open pull requests the Opus review already said to merge.
