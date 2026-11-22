# Scheduled tests

Source: https://kensaur.us/mushi-mushi/docs/admin/qa-coverage

---
title: Scheduled tests
description: Scheduled tests in the Mushi Mushi console turn plain-English user flows into browser tests on a schedule, so you find out when login or checkout breaks.
---

# Scheduled tests

**Route:** `/qa-coverage` (sidebar: Checks › Scheduled tests; formerly QA Coverage)

> **Scenario:** You shipped a login flow last week and want to know automatically
> if it still works — without writing a full Playwright suite from scratch.

Scheduled tests in Mushi Mushi let you describe user flows in plain English, run them on a schedule, and get screenshots plus failure evidence when something breaks.

## The status line

The page opens on one line that says what is wrong and holds the one button
that fixes it, worst first:

| What it says | The button |
|--------------|-----------|
| *N tests failing in the last 24 hours. Worst: Login.* | **Open Login** (its run history) |
| *N tests never ran: they are set to run on your computer only.* | **Run all N in the cloud** (switches them to Firecrawl, so the schedule runs them). Viewers get the `mushi qa run ` command instead |
| *N runs in progress.* / *All N tests passed in the last 24 hours.* | **Refresh** |

Beside it, up to three numbers: **Passing**, **Failing** and **Never ran**
(turned-on tests the schedule skipped all day, so nothing was checked).

---

## Story lifecycle

```
Create story (NL prompt or Playwright script)
  → stored in qa_stories (schedule_cron: '0 * * * *' default)
  → pg_cron fires qa-story-runner every minute
  → BYOK key resolution (firecrawl / browserbase / openai)
  → execute via provider
  → write qa_story_runs (status, latency_ms, provider_session_url, assertion_failures)
  → write qa_story_evidence (screenshots, console logs, HAR)
  → on fail/recover → Slack Block Kit (transition-aware) + Discord webhook + dispatchPluginEvent
```

---

## Execution providers

| Provider | Description | When to use |
|----------|-------------|-------------|
| **Firecrawl** | Cloud-hosted — no setup required | Default. Good for content checks and basic navigation |
| **Browserbase** | Full Chromium in the cloud | Complex UI interactions, video recording, HAR export |
| **Local** | Playwright on your machine via CLI | Full Playwright access; not schedulable via edge function |

To use Browserbase or Firecrawl, add your key in **Settings → Web tools** first,
then select the provider when creating a story.

---

## Creating a story

1. Click **+ New story** (header or empty state).
2. In the **New QA story** modal, fill in:
   - **Name** — short label for the story card
   - **Target URL** — the page the runner opens first (required for Firecrawl and Browserbase)
   - **Prompt — describe what to verify** — your user story in plain English (e.g. "Open the Reports page, click the first report, verify the classification badge is visible")
   - **Browser provider** — Firecrawl Actions (recommended) / Browserbase / Local Playwright (CLI only)
   - **Run schedule** — every hour (default), every 6 hours, daily, weekly, or a custom cron
3. Click **Create story**.

In the story drawer you can change the target URL and turn the story on or off.

**Generate test** on a bug's detail page creates a story and opens a draft GitHub PR
with a full Playwright test. The story uses the `local` provider and runs weekly
(Mondays 06:00 UTC).

---

## Story cards

The main grid shows one card per story with:
- **State** as a mark and a word: ✓ Passed, ✕ Failed, ⊘ Skipped, ○ Never ran,
  Queued, Turned off
- **Where it runs**: *On your computer*, *Cloud · Firecrawl* or *Cloud · Browserbase*
- **Why it was skipped**, with the fix in the card:

  | Runner | Why the schedule skips it | Fix on the card |
  |--------|---------------------------|-----------------|
  | On your computer | The cloud runner never runs it; only `mushi qa run ` on your computer does | **Run in the cloud**, or copy the command |
  | Cloud · Browserbase | Browserbase opens the session, but the test still needs the CLI runner | **Run in the cloud** (Firecrawl), or copy the command |
  | Cloud · Firecrawl | Too many tests ran at once for this app; the next tick runs it | none needed |

  **Run in the cloud** reads each test first. A test that holds a Playwright
  script (the kind **Generate test from report** writes) stays on your
  computer: the cloud runner would ignore the script and could pass without
  running the test. The page says so and points you at its `mushi qa run `
  command; the story drawer shows only the command for it.

- **24h pass rate** over finished runs — bar and percentage; "nothing checked"
  when every run was skipped
- **7 days** — one heat cell per UTC day with a glyph: ✕ red when a run failed
  that day, ✓ green when every finished run passed, ⊘ grey when every run was
  skipped, blank with none. Skipped runs never count as failures. From `last_7d`
  on `GET /v1/admin/projects/:id/qa-coverage` (`{ day, passed, failed, skipped }`;
  `null` when the runs could not be read)
- **Run count** and **last run** time
- Link to last failure Browserbase replay session

## Story drawer

Click any card to open the story drawer:

- **Story prompt** and **where it runs** at the top, with **Run in the cloud**
  and the `mushi qa run ` command when it is not on Firecrawl
- **Script** section (collapsible) — the raw Playwright script if one was generated
- **Run history** — newest runs first. Expand any run to see:
  - Meta (status, provider, latency)
  - **Summary** and error message
  - **Assertion failures** table — each failing assertion listed
  - **Evidence** — screenshots, video thumbnail, HAR download
  - **Browserbase replay** link (if Browserbase was used)
- A live indicator and 3-second auto-poll when a run is active

---

## Manual run

Click **Run now** on any story to trigger an immediate execution regardless of its
schedule. The story must be on: a story that is off says "Turn the story on first";
turn it on in the story drawer.

---

## Filters

The chips above the grid filter the stories: **All**, **Failing**, **Passing**,
**No runs in 24h** and **Turned off**. The 24-hour pass rates come from the
`qa_story_coverage_24h` materialised view, refreshed every 15 minutes.

---

## Related pages

- [Mushi Mushi health](/admin/health) — verify Firecrawl / Browserbase keys
- [Improvement runs](/admin/iterate) — producer and judge iteration loop
- [Fixes](/admin/fixes) — act on test failures
