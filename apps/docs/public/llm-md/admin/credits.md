# Spend credits

Source: https://kensaur.us/mushi-mushi/docs/admin/credits

---
title: Spend credits
description: Spend credits lists expiring Cursor and Firecrawl credits and every way Mushi can spend them fixing bugs, improving apps with skills and checking sites.
---

# Spend credits

**Route:** `/credits`

Cursor and Firecrawl credits that lapse at the end of a period are worth more spent on your apps. This page shows when each key's credits expire and lists every place Mushi can spend them, with a switch for each. The full form behind each switch stays where it was (Settings → AI keys, Settings → Web tools, Inventory → Discovery); this page answers one question: is anything spending them, and on what?

## Cursor: fix bugs

Each Cursor key shows its hint, label and expiry ("expires Oct 28 (6 days)").

- **Fix open bugs before the credits expire** turns [spend-down](../concepts/agent-pr-review#spend-down-and-its-safety-stop) on or off for that key. While it is on, Mushi sends your best open reports to Cursor on its own, inside each app's auto-fix limits, and every fix opens a draft pull request. The switch is off until the key has an expiry date; set it in Settings → AI keys. A key your organization shares can be changed by an owner or admin, and someone else's universal key only by its owner.
- When every app has nothing left to send, the row says so. Watching more of your live sites (below) is the way to find more.
- **Review follow-ups** sends a pull request the Opus review marked "fix first" back to a new Cursor agent with the review's findings, at most twice per pull request and never on a "hold". The line names the model each round uses; when a **Last round model** is set in Settings → AI keys, the second round, which only happens after the first did not satisfy the reviewer, runs on it (for example Opus while the first stays on Grok).

## Cursor: improve your apps with skills

A **skill run** applies one skill from your synced skills catalog to one part of one app, for a few rounds, on that app's own Cursor key. Pick:

- **App** and **Skill**: only skills whose result an agent can measure and that need no product decision are offered, such as accessibility, layouts at every width, loading/empty/error states, page UX, readability, forms, native feel, one design system, translations, SEO, performance, bundle size, error handling, dead code and unit tests. Under the picker, the page says what each round measures.
- **What to work on**: a part of the app, such as "the /settings pages", "the checkout flow" or "src/components/cards". A run never works outside it.
- **Rounds at most** (1 to 5) and **Merge each round when Opus approves and CI passes** (on by default).

Each round is a report that spend-down sends to Cursor with the skill's instructions. The agent measures first, makes the changes in that part only, and opens a pull request with the numbers before and after. Opus reviews it like any fix. With merging on, an approved round goes into the [merge queue](fixes#merge-when-ready), and the next round builds on what merged. A run ends when the agent finds nothing left to change or after its last round. It stops when the agent says the rest needs your decision, when you dismiss a round, or when you press **Stop**. Each app can have up to 5 runs going.

## Firecrawl: find bugs on your live sites

The first line is the Firecrawl balance and when it resets. Unused credits do not roll over. The next line is the pace: what the site watches use a day, what that comes to before the reset, and what would go unused at that pace.

Each app has a row:

- **Watch the live site daily** turns its [live-site watch](./inventory) on or off. Turning it on uses the address shown, the app's suggested address, or one you type, at 25 pages a check. Turning it off asks first, then deletes the Firecrawl monitor; reports it already filed stay.
- **Watch up to 100 pages** appears when a watch reads fewer pages than one check allows.
- An app with no Firecrawl key it can use says so. Add a key, or share yours with all your apps, in Settings → Web tools.

A broken page becomes a bug report only after a second check confirms it, and spend-down can then send it to Cursor.

### Site audit

Under each app's watch, **Audit links, accessibility and translations weekly** turns on its [site audit](https://github.com/kensaurus/mushi-mushi/blob/master/docs/adr/0040-site-audit-deterministic-live-site-checks.md). Once a week (the first run starts within the hour) Mushi maps the live site, reads every page under its address (up to 200, one Firecrawl credit each) and checks:

- links to the site's own pages, to other sites and to images that are 404, 410, 5xx or unreachable (a 401, 403 or 429 is often a bot wall and does not count; Facebook, Instagram, LinkedIn, X and calendar links are skipped);
- pages with no title, meta description or ``;
- on `/th`, `/zh`, `/en` … pages: a title or description in another language, another locale's text in the page, and links that drop the visitor's language;
- images without alt text.

Each failing rule files one report listing the pages and evidence, with how to check it is fixed, and spend-down can send it to Cursor. While that report is open, later runs refresh it instead of filing again; a report you dismiss is not filed again; a fixed one that fails again files a new report. **Run now** starts a run (3 an hour per app). The row shows the last run: pages read, rules failing and reports filed.

### Search rank

Each app can also track where it ranks in web search for the words its users would type. **Add keywords** opens a box: one query per line, at most 10, with `@JP`, `@TH` … at the end for another country (US by default). Mushi looks for the app's watched or audited address in the top 20 results, once a week per keyword (about 4 Firecrawl credits each), and **Check now** reads them straight away (3 an hour). Each keyword shows its position, the change since the last check ("#2 (was #5)"), or "not in the top 20"; hover it to see the leading sites. It is a visibility number for you and files no reports.

## Where the fixes go

Fixes these levers open are on [Fixes](./fixes). The **Opus: merge** filter there lists the open pull requests the Opus review already said to merge.
