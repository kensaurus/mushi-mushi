# AI prompts

Source: https://kensaur.us/mushi-mushi/docs/admin/prompt-lab

---
title: AI prompts
description: The AI prompts page in the Mushi Mushi console lets you edit and A/B compare the prompts behind each AI step before you promote a new version.
robots:
  index: false
  follow: true
---

# AI prompts

**Route:** `/prompt-lab` (sidebar: **AI prompts**; formerly Prompt lab). `/fine-tuning` redirects here.

AI prompts is a Lab: it is under **More pages** in the sidebar, and Settings → Display & sidebar can keep it in the sidebar. The page
works by URL either way.

**First on the page:** one recommendation in plain words and its button, picked from
every step:

| The line says | Button |
|---|---|
| "A newer Diagnosis prompt scores 72% vs 61% for the one in use. Switch to it." | **Switch to it** (asks first) |
| "Fast filter has a test version that gets no reports … Start it on 1 in 10 reports." | **Start on 1 in 10 reports** |
| "A newer Diagnosis prompt scores 49% vs no grade yet … Not enough grades yet: 6 more needed." | **Open grading** (points at Triage grading's Run button) |
| "Each step runs one prompt; nothing is being tested." | none |

Switching is suggested only when the nightly auto-promotion would do it too: 30 grades
and more than 5% better than the version in use. Built-in versions are never switched
to from here; clone them first.

Under it, **Versions and their grades** has one row per AI step (Fast filter, Diagnosis,
Grading, Fix writer, …) with the version in use, the version being tested, their grades,
and a verdict ("Testing on half of reports, waiting for grades", "Not started: gets no
reports"). A row opens that step's version table.

> **Scenario:** Your fix-worker has been generating patches that touch the wrong file
> 20% of the time. You suspect the Stage 1 classifier is mislabelling the component
> field — so the fix agent is looking at the wrong area of the codebase. You want to
> try a new prompt, test it on real traffic, and promote it only if the judge confirms
> it's better than what's live.

AI prompts is where you iterate on the prompts behind each Mushi Mushi AI step. You do
not redeploy anything: a version takes effect on the share of traffic you give it.

---

## The 4-step workflow

The **How prompt tuning works** panel lists the steps:

```
1. Build eval dataset → 2. Clone a baseline → 3. A/B at low traffic → 4. Promote when judge ≥ 80%
```

**Step 1 — Build eval dataset:** grades need classified reports. The **Eval dataset**
card shows the recent classified reports the grader can use, one line each: a severity
glyph and the report's title. **Details** shows its category, area and full text.

**Step 2 — Clone a baseline:** click **Clone** (the copy icon) on the version in use. The
copy starts at 0% traffic, so it serves no live requests yet. Click **Edit** to change
its template. Steps marked **Built-in** cannot be cloned: no worker reads a project copy
of that prompt yet.

**Step 3 — Test on a share of reports:** use the sliders icon (**Choose how many reports
this version tests on**) to give the copy a small share (for example 10%, "1 in 10
reports"). The judge runs nightly and grades both versions. Compare their **Grade** bars
once each has a fair number of **Grades**.

**Step 4 — Switch:** click **Switch to this** and confirm **Switch to it**. Every new
report in that step uses the version, and the step's tests stop. The nightly judge run also promotes a candidate on its own
once it has at least 30 evaluations and scores more than 5% above the version in use.

The judge runs once per night, so an A/B test needs a few nights of data. Don't promote
after a single night.

---

## Summary tiles

| Tile | What to watch |
|------|--------------|
| **In use** | Prompt versions serving traffic |
| **Being tested** | Candidate versions in an A/B test |
| **Best grade** | The best judge score among the versions |

---

## Steps

Each tab is one AI step. Only steps with prompt rows appear. Start with the one causing
your problem:

| Step | Prompt controls |
|-------|----------------|
| **Fast filter** (`stage1`) | Spam detection: edit if legitimate reports are being dropped |
| **Diagnosis** (`stage2`) | Category, severity and component: edit if labels are wrong |
| **Grading** (`judge`) | The grader: edit if its scores don't match your own judgement |
| **Fix writer** (`fix`) | Code patch generation |
| **Weekly summary** (`intelligence`) | The weekly insights digest |
| **Question to SQL** / **Answer summary** | The SQL query page |
| **Test reports** (`synthetic`) | Generated test reports |

Other steps (for example **Dependency upgrades**, **Prompt tuner**, **Story map audit**)
show up when they have prompt rows.

---

## Prompt table columns

| Column | What it tells you |
|--------|------------------|
| **State** | A glyph and plain words: **In use**, **Testing on half of reports**, **Not started**, **Idle**; plus **Global** for a built-in version and **Auto** when the weekly prompt tuner drafted it |
| **Version** | The raw version id, as small grey text |
| **Grade** | A bar on 0–100%. Higher is better. Uses the rolling 7-day evaluation window |
| **Grades** | How many grades the score is based on. A low count means an unreliable score |
| **Share of reports** | A bar of what share of new reports this version diagnoses |
| **Updated** | When the version last changed |

---

## Actions per row

| Action | When to use it |
|--------|---------------|
| **Clone** | Starting point for any edit. Built-in versions are read-only; clone first |
| **Edit** | Open the template editor for a project version |
| **Diff** | Compare against the version it was cloned from. Use before promoting |
| **Choose how many reports** (sliders) | Raise a test's share of reports gradually |
| **Switch to this** | Use this version for every report in the step; tests stop |
| **Delete** | Remove a candidate that didn't work out. Its past evaluations stay |

---

## Common tasks

### Fixing wrong component classification
1. Open the **Diagnosis** tab.
2. **Clone** the version in use.
3. **Edit** the template: add explicit examples of the component names your codebase uses.
4. Give it a 10% share of reports.
5. Wait a few nights. Is its **Grade** above the version in use?
6. If yes: **Diff**, then make it the live prompt. If not: edit and try again.

### Investigating a bad judge score
1. Open the tab for the step with the low score.
2. Check **Grades**. With fewer than 10, the score isn't meaningful yet: wait.
3. With more than 20 and a still-low score, the prompt is likely wrong. Clone and start fresh.

---

## Advanced: fine-tuning & synthetic

This closed panel at the foot of the page holds two rarely used tools:

- **Fine-tuning jobs**: export classified reports and train a small model. See
  [Fine-tuning](/admin/fine-tuning).
- **Synthetic reports**: generate artificial test reports that match your real report
  patterns, to grow the set of reports the grader can score.

---

## API

```bash
GET    /v1/admin/prompt-lab
POST   /v1/admin/prompt-lab/prompts        { stage, name, promptTemplate }
PATCH  /v1/admin/prompt-lab/prompts/:id    { isActive, trafficPercentage, promptTemplate }
DELETE /v1/admin/prompt-lab/prompts/:id
```

---

## Related pages

- [Triage grading](/admin/judge) — nightly judge scores
- [Fine-tuning](/admin/fine-tuning) — train a small model from your classified reports
- [Mushi Mushi health](/admin/health) — check Mushi Mushi's AI calls before testing prompt changes
