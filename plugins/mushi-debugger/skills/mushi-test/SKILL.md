---
name: mushi-test
description: "Test a live app with Mushi Mushi and prove the whole loop works: send a report and check its plain-English diagnosis, map user stories from the live URL, generate Playwright tests, approve and run them, and let the auto-improve loop rewrite failing ones. Use when asked to run, generate, review or improve Mushi tests, check QA coverage, test the Mushi integration, run a Mushi e2e or smoke test, verify the full pipeline, or after deploying changes."
triggers:
  - "run tdd tests"
  - "generate tests for my stories"
  - "check qa coverage"
  - "improve failing tests"
  - "test my app with mushi"
  - "review generated tests"
  - "map user stories"
  - "qa story"
  - "test mushi integration"
  - "mushi integration"
  - "mushi integration test"
  - "mushi e2e"
  - "mushi smoke test"
  - "verify full pipeline"
  - "does mushi work end-to-end"
  - "full mushi pipeline check"
license: MIT
---

<!-- GENERATED from skills/mushi-test/SKILL.md by scripts/sync-skills.mjs. Do not edit this copy: edit the source, then run `pnpm sync:skills`. -->

# Mushi Mushi — tests and the end-to-end smoke test

```
report → diagnosis → map stories → generate tests → approve → run → improve failures → repeat
```

Run the stages in order for a full smoke test, after setup or after a deploy.
Skip to stage 3 when you only want tests for your app. Every check uses the
CLI, the MCP server or the console.

Every `mushi <command>` below also runs as `npx mushi-mushi <command>`, with no
install. `npm install -g @mushi-mushi/cli` gives you the short `mushi`.

## Prerequisites

- `mushi doctor` passes. If unsure, run the health check in
  [`mushi-debug`](../mushi-debug/SKILL.md) first.
- An AI key (the hosted free plan includes one) and a Firecrawl key for
  story mapping, under **Settings → AI keys**.
- The public URL of the app (not localhost).

---

## Stage 1 — Bug capture

```bash
mushi test
```

Expected: `✓ Test report submitted`, then the report's `ID`, its `Status` and
a `View` link into the console.

## Stage 2 — Diagnosis

```bash
mushi reports list --limit 1
```

Expected: the newest report's `STATUS` reaches `classified` and its `SEV`
column is filled within about 30 seconds. Still `pending` after a minute means
classification failed; see [`mushi-debug`](../mushi-debug/SKILL.md).

From the editor (MCP):

```
get_report_detail { reportId: "<id>" }
get_fix_context { reportId: "<id>" }
```

The report should carry a severity, a category and a plain-English root cause,
and `get_fix_context` should return a fix prompt with the files involved.

**Fastest smoke test:** stages 1–2 only. About a minute, and it proves capture
plus diagnosis are alive.

---

## Stage 3 — Map user stories

```bash
mushi stories map --url https://your-app.com --wait
```

`--wait` polls every 5 s, for up to about three minutes (usually 30–90 s).
`--max-pages <n>` caps the crawl (default 20); `--provider browserbase` crawls
pages that need a real browser. Expected output:

```
✓ Crawl started — run id: <run-id>
  Crawling https://your-app.com with firecrawl…
  Polling for results…
......
✓ Done! 12 pages crawled.
  Proposal id: <proposal-id>
  Review in the console: Inventory → Discovery → Past proposals
```

A failed crawl prints `✗ Crawl failed: <reason>` and exits non-zero.

Accept the proposal in the console (**Inventory → Discovery → Past proposals
→ Accept**). The accepted stories appear under **Inventory**. MCP:
`map_user_stories` starts a crawl and `get_map_run_status { projectId }` shows
recent ones.

## Stage 4 — Generate a test

```bash
mushi tdd gen <story-id> --mode review
mushi tdd pending
```

Expected output from `gen`:

```
Generating TDD test for story: <story-id>…
✓ Test generated — qa_story id: <qa-story-id>
  Approval status: pending_review
  PR: https://github.com/.../pull/...
```

Each generated test is a Playwright spec (`@playwright/test`) plus a Firecrawl
Actions version for cloud runs. The `PR:` line appears only when a GitHub PR
was opened; `--no-pr` skips it.

MCP: `generate_tdd_from_story { projectId, storyNodeId, automationMode: "review" }`,
then `list_pending_review_stories { projectId }`.

| Mode | What happens | Use when |
|------|--------------|----------|
| `auto` | Enabled in the QA schedule immediately | You trust the output, or CI-only projects |
| `review` | Waits in the pending-review queue (default) | Check it before it runs on a schedule |
| `approve` | Created disabled; you enable it by hand | Explicit approval-first workflow |

## Stage 5 — Approve and run

```bash
mushi tdd approve <qa-story-id>      # add --reject to reject it
mushi qa run <qa-story-id>
mushi qa runs <qa-story-id>
```

Expected: a new run marked `PASS` or `FAIL` (`PEND` while it runs). A failure
is fine here: the test ran and caught real friction. Approved tests then run
on their cron (hourly by default). In the console, **QA Coverage** shows each
story's pass rate, last run and replay link.

MCP: `approve_qa_story`, `run_qa_story { projectId, qaStoryId }`,
`list_qa_story_runs` and `get_qa_story_run` for screenshots and assertion
failures.

To run a generated spec locally:

```bash
npx playwright install chromium
BASE_URL=https://your-app.com npx playwright test tests/user-login.spec.ts
```

## Stage 6 — Auto-improve

```bash
mushi tdd improve
```

Failing generated tests are rewritten (selector and timing fixes), linked to
the original through `parent_story_id`, created with `source=pdca` and queued
for review: they show in `mushi tdd pending` and under **QA Coverage**. The
improver also runs on a schedule. Accept the improved version and reject the
old one. MCP: `improve_qa_story`.

## Stage 7 — Is the loop converging? (optional)

Read the MCP resource `project://dashboard` and look for rising judge scores,
a falling recurrence rate (the same bugs coming back) and more completed fix
attempts than failed ones.

---

## Pass/fail summary

| Stage | What ran | Status | Notes |
|-------|----------|--------|-------|
| 1. Bug capture | `mushi test` → report accepted | ✅ / ❌ | |
| 2. Diagnosis | classified, fix context returned | ✅ / ❌ | |
| 3. Story mapping | crawl → proposal accepted | ✅ / ❌ | |
| 4. Test generation | `mushi tdd gen` → pending review | ✅ / ❌ | |
| 5. Approve and run | `mushi qa run` → run recorded | ✅ / ❌ | |
| 6. Auto-improve | `mushi tdd improve` → rewritten test queued | ✅ / ❌ | |

All ✅ → Mushi Mushi works end to end. Any ❌ →
[`mushi-debug`](../mushi-debug/SKILL.md) for targeted diagnosis.

## Tips

- **Story map only:** stage 3. Useful after changing the Firecrawl key or
  after the app's pages change.
- **Generated tests only:** stages 4–6.
- **Browserbase vs Firecrawl:** runs use Firecrawl actions by default. To test
  Browserbase, set the story's provider to `browserbase` in the console first.
