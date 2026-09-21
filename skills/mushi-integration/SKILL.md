---
name: mushi-integration
description: "End-to-end Mushi Mushi smoke test: a report goes in, gets a plain-English diagnosis, then story mapping, test generation, approval, a QA run and the auto-improve loop are each exercised. Use when asked to test the Mushi integration, verify the full pipeline, run a Mushi e2e or smoke test, or after deploying changes."
triggers:
  - "test mushi integration"
  - "mushi e2e"
  - "verify full pipeline"
  - "mushi integration test"
  - "mushi smoke test"
  - "does mushi work end-to-end"
  - "full mushi pipeline check"
  - "mushi integration"
license: MIT
---

# Mushi integration smoke test

Exercises every stage of the Mushi pipeline end to end. Run it after setup,
after a deploy, or any time you need proof that the whole loop works. Every
check uses the CLI, the MCP server or the console.

## Prerequisites

- `mushi doctor` passes — run [`mushi-health`](../mushi-health/SKILL.md) first if unsure.
- At least one active BYOK key for `anthropic` (and `firecrawl` for stage 3).
- The URL of the app you want to map stories from.

---

## Stage 1 — Bug capture

Send a real test report through the ingest pipeline:

```bash
mushi test
```

Expected: `Test report submitted — id: rep_...`

---

## Stage 2 — Diagnosis

Confirm the classifier ran:

```bash
mushi reports list --limit 1
```

Expected: the newest report reaches `classified` with a severity and category
within about 30 seconds. Still `pending` after a minute means classification
failed — see [`mushi-debug`](../mushi-debug/SKILL.md).

**From your editor (MCP):**

```
get_report_detail(reportId)
get_fix_context(reportId)
```

Confirm the report carries a severity, a category and a plain-English root
cause, and that `get_fix_context` returns a fix prompt with the files involved.

---

## Stage 3 — Story mapping

Map user stories from a live URL:

```bash
mushi stories map --url https://your-app.com --wait
```

`--wait` polls until the crawl finishes (usually 30–90 s). Expected terminal
output:

```
✓  Crawled 12 pages
✓  Claude drafted 8 user stories
✓  Proposal created: prop_...
Open in console → Inventory → Discovery → Past proposals
```

**Accept the proposal** in the console (**Inventory → Discovery → Past
proposals → Accept**). The accepted stories then appear under **Inventory**.

---

## Stage 4 — Test generation

Pick a story id from the accepted inventory and generate a Playwright test:

```bash
# Generate a test (review mode — goes to the approval queue)
mushi tdd gen <story-id> --mode review

# Confirm it is waiting for review
mushi tdd pending
```

Expected output from `gen`:

```
✓  Test generated: qa_...
✓  Draft PR opened: https://github.com/.../pull/...
   Waiting for approval — run: mushi tdd approve qa_...
```

**Via MCP:**

```
list_pending_review_stories(projectId)
```

---

## Stage 5 — Approval and execution

Approve the generated test and run it once:

```bash
mushi tdd approve <qa-story-id>
mushi qa run <qa-story-id>
```

Check the result:

```bash
mushi qa runs <qa-story-id>
```

Expected: a new run that `passed` or `failed`. A failure is fine here — it
means the test ran and caught real friction.

**Via MCP:**

```
run_qa_story(projectId, qaStoryId)
```

---

## Stage 6 — Auto-improve

If stage 5 failed, trigger the improver:

```bash
mushi tdd improve
```

Expected: a rewritten test is created with `source=pdca`, linked to the
original story, and queued for review — it shows up in `mushi tdd pending` and
under **QA Coverage** in the console.

---

## Stage 7 — Is the loop converging? (optional)

Read the project dashboard through the MCP resource:

```
project://dashboard
```

Look for:
- Rising judge scores over time.
- A falling recurrence rate (the same bugs coming back).
- More completed fix attempts than failed ones.

---

## Pass/fail summary

| Stage | What ran | Status | Notes |
|-------|----------|--------|-------|
| 1. Bug capture | `mushi test` → report accepted | ✅ / ❌ | |
| 2. Diagnosis | classified, fix context returned | ✅ / ❌ | |
| 3. Story mapping | crawl → proposal accepted | ✅ / ❌ | |
| 4. Test generation | `mushi tdd gen` → pending review | ✅ / ❌ | |
| 5. Approval + run | `mushi qa run` → run recorded | ✅ / ❌ | |
| 6. Auto-improve | `mushi tdd improve` → rewritten test queued | ✅ / ❌ | |

All ✅ → Mushi is working end to end.
Any ❌ → use [`mushi-debug`](../mushi-debug/SKILL.md) for targeted diagnosis.

---

## Tips

- **Fastest smoke test:** stages 1–2 only. About a minute, and it proves
  capture plus diagnosis are alive.
- **Story map only:** stage 3. Useful after changing the Firecrawl key.
- **Generated tests only:** stages 4–6.
- **Browserbase vs Firecrawl:** stage 5 uses Firecrawl actions by default. To
  test Browserbase, set the story's provider to `browserbase` in the console
  first.
