---
name: mushi-test
description: Run, review, and improve Mushi Mushi TDD tests — story mapping, Playwright test generation, QA coverage, PDCA improvement loop, test approval workflow. Use when "run tdd tests", "generate tests for my stories", "check qa coverage", "improve failing tests", "test my app with mushi", "review generated tests", or any TDD/QA workflow in mushi.
---

# Mushi TDD Testing Guide

## The TDD Loop

```
Live App → map stories → generate tests → approve → run → analyze failures → improve → repeat
```

## Step 1: Map User Stories

```bash
# Automatic discovery from live app (recommended)
mushi stories map --url https://your-app.com --wait

# Or use the console: Inventory → Discovery → "Map from live app"
```

Review the draft in **Inventory → Discovery → Past proposals** and click **Accept**.

## Step 2: Generate Playwright Tests

```bash
# From CLI (after accepting a proposal)
mushi tdd gen <story-id> --mode review

# Options:
# --mode auto   → enabled immediately, no approval needed
# --mode review → lands in pending queue (default)
# --no-pr       → skip GitHub PR

# Or via MCP in Cursor:
# generate_tdd_from_story(projectId, storyNodeId, automationMode: 'review')
```

Each generated test includes:
- Full TypeScript Playwright spec (`@playwright/test`)
- Firecrawl Actions YAML equivalent (for cloud-only execution)
- Draft GitHub PR (if configured)

## Step 3: Review and Approve

```bash
# See what needs review
mushi tdd pending

# Approve a test (enables it in QA schedule)
mushi tdd approve <qa-story-id>

# Reject a test
mushi tdd approve <qa-story-id> --reject
```

In the console: **QA Coverage → "TDD Tests Pending Review"** banner shows the queue.

## Step 4: Run Tests

Tests run automatically on cron (default: hourly).

```bash
# Trigger manually
mushi tdd run <qa-story-id>

# Or via MCP: run_qa_story(projectId, qaStoryId)
```

Monitor results in **QA Coverage** — each card shows pass rate, last run status, and Browserbase replay link.

## Step 5: PDCA Auto-Improve

When tests fail repeatedly, the PDCA improver proposes fixes:

```bash
# Run immediately
mushi tdd improve

# Runs automatically every 6 hours via pg_cron
```

Improved tests appear in the pending review queue with `source=pdca` and a `(PDCA v2)` suffix.

## Automation Modes

| Mode | What happens | Use when |
|------|-------------|----------|
| `auto` | Tests run immediately after generation | You trust the LLM output, CI-only projects |
| `review` | Tests queued for human approval | Default — verify before running in schedule |
| `approve` | Same as review | Explicit approval-first workflow |

## Running Tests Locally

```bash
# Install Playwright
npx playwright install chromium

# Run a generated test file
BASE_URL=https://your-app.com npx playwright test tests/user-login.spec.ts
```

## Checking QA Health

Via MCP in Cursor:
```
list_pending_review_stories(projectId) → shows queue
get_map_run_status(projectId) → shows recent crawls
```

Via CLI:
```bash
mushi tdd pending   # approval queue
mushi stories map --url <url> --wait  # re-map after app changes
```

## RED-GREEN-REFACTOR with Mushi

1. **RED**: Generate a test from a story (`mushi tdd gen`) — it may fail on first run if UI changed
2. **GREEN**: The PDCA improver (`mushi tdd improve`) fixes selector/timing issues
3. **REFACTOR**: Accept the improved version, reject the old one

The `parent_story_id` chain tracks test lineage across PDCA iterations.
