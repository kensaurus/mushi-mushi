# Improvement runs

Source: https://kensaur.us/mushi-mushi/docs/admin/iterate

---
title: Improvement runs
description: The Improvement runs page in Mushi Mushi queues runs where one AI critiques a live URL against your goal and a second scores it, iteration by iteration.
---

# Improvement runs

**Route:** `/iterate` (sidebar: More pages → Fix → Improvement runs; formerly Iterate. It is a Lab: switch it on under **Settings → Display & sidebar → Labs** to keep it in the sidebar)

> **Scenario:** Your app's UX scores have been declining in session recordings. You
> suspect the onboarding flow has friction but don't know where. Instead of spending
> a day manually testing every screen, you queue an improvement run — point it at your live
> URL, describe the goal, and let the producer and judge models critique and
> score it. You come back to a scored report for each iteration.

In Mushi Mushi, the Improvement runs page runs **Plan → Do → Check → Act** scoring loops. The agent
crawls a URL, generates a quality critique across multiple dimensions (UX, performance,
accessibility, etc.), attempts improvements, re-checks the score, and loops until either
the target score is reached or the iteration limit is hit.

---

## Understanding the score

Each run produces a **final score** from 0 to 1. This is the judge model's assessment
of the target URL against the goal you described. A score of 0.85 means the judge
considers the URL 85% of the way to fully satisfying the goal.

The **score timeline** chart in the run drawer shows one bar per iteration. Increasing
bars mean the agent is making real improvements. Flat or decreasing bars mean either
the goal is too vague or the BYOK model is struggling — try a more specific goal or a
stronger model.

---

## Runs table

The left panel lists all runs, newest first. At a glance:
- **Status badge** — `queued`, `running`, `succeeded`, `aborted`, `failed`
- **Progress** — current / target iterations (e.g. "3/5")
- **Final score** — the bar fills as the score improves across iterations
- **Trigger** appears on a queued row, **Abort** on a queued or running row (Abort asks first)

An **auto-refresh banner** appears at the top when any run is active, polling every
4 seconds so you don't need to manually refresh.

---

## Run detail drawer

Click any run row to open the detail drawer.

### Score timeline

A bar chart with one bar per iteration. Click any bar to jump to that iteration's
detail — its critique text, per-dimension scores, and cost.

### Iterations list

Expand any iteration to see:
- **Overall score bar** for that iteration
- **Per-dimension breakdown** — separate scores for dimensions like UX clarity,
  navigation depth, content quality, error handling
- **Critique text** — the judge model's written assessment of what it found
- **Time elapsed + cost** — how long and how expensive that iteration was

### Succeeded run
When the run succeeds, a **Copy critique to clipboard** button appears. Paste this into
a GitHub issue, Notion doc, or design brief as a structured improvement report.

While a run is queued or running, the drawer reloads itself every 3 seconds. **Refresh**
in the drawer header reloads it at once.

---

## Creating a run

1. Click **+ New Run** (top of page).
2. On the **New Run** tab, fill in:

| Field | Guidance |
|-------|---------|
| **Target URL** | The live URL the agent will crawl — must be publicly reachable |
| **Goal / instructions** | Be specific: *"Improve the onboarding flow for first-time mobile users — focus on step clarity and reducing friction"* is better than *"improve UX"* |
| **Max iterations** | Default 5. More iterations cost more, with diminishing returns |
| **Target score (0–1)** | Default 0.75. 1.0 is rarely reached and will use up every iteration |
| **Producer model** | The model generating improvements: Claude Sonnet 5.5 (default), Claude Opus 5.5, Claude Fable 5.1 or Claude Haiku 5.5 (fastest, cheapest). If Anthropic is down the runner falls back to OpenAI on its own |
| **Judge model** | The model scoring results. Same choices, Sonnet 5.5 by default. Only Claude ids are accepted (`claude-…`) |
| **Critic persona** | The evaluation lens: Nielsen Norman (10 usability heuristics, default), WCAG 2.2 accessibility, Mobile first, Glanceable density, or Tufte data density |

3. Click **Queue run**. The run is saved as `queued`; click **Trigger** on its row in **Runs** to start it.

---

## Common tasks

### Running a UX audit before a release
1. Create a new run: target URL = your staging URL, goal = *"Identify UX friction in the checkout flow"*, max iterations = 3, target score = 0.8.
2. Click **Trigger** and let it run.
3. Open the drawer → read the final critique → **Copy critique to clipboard**.
4. File as a GitHub issue or share with your design team.

### Comparing before and after a change
1. Run a baseline before your change. Note the final score.
2. Deploy your change. Run again with identical config.
3. Compare the final scores and the per-dimension breakdown charts.
4. A higher score on the "UX clarity" dimension confirms your change worked.

### Debugging a failed run
1. Click the failed run row and check which iterations finished and what they scored.
   The console does not show the runner's error message for a failed run; the
   **Last failure** line of the readout only names the URL.
2. Common causes:
   - **LLM key not configured** → go to [Settings](/admin/settings) → **AI keys**
   - **Target URL unreachable** → check the URL returns 200 without authentication
   - **Iteration limit hit with low score** → rewrite the goal to be more specific or increase the target score threshold

---

## API

```bash
GET    /v1/admin/pdca?project_id=<pid>&limit=50
GET    /v1/admin/pdca/<id>
POST   /v1/admin/pdca   { "target_url": "...", "goal": "...", "iterations_target": 5,
                          "target_score": 0.85, "primary_model": "claude-sonnet-5-5",
                          "judge_model": "claude-haiku-5-5", "project_id": "<pid>" }
DELETE /v1/admin/pdca/<id>         (abort)
POST   /v1/admin/pdca/<id>/trigger (manually trigger queued run)
```

---

## Related pages

- [Schema changes](/admin/drift) — check for regressions before starting an iteration loop
- [Mushi health](/admin/health) — verify LLM keys are working before queuing a run
- [Fixes](/admin/fixes) — dispatch individual fixes outside the PDCA loop
