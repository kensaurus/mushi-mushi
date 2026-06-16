---
title: Run a QA story
routes:
  - /qa-coverage
  - /inventory
kind: recipe
---

# Run a QA story

Execute scheduled Playwright user-story tests against your live app.

## Steps

1. Open **QA Coverage** (`/qa-coverage`).
2. Browse existing **qa_stories** or create one with a natural-language prompt or Playwright script.
3. Set **approval_status** to approved before scheduled runs execute.
4. Click **Run now** on a story for a manual trigger.
5. Review run evidence (screenshots, console logs) in the run detail drawer.
6. Failures notify Slack/Discord per your notification rules on `/notifications`.

## Tips

- Generate tests from reports via "Generate test from report" on the Reports page.
- User stories inventory lives on `/inventory` (advanced mode).
