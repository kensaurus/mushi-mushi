# Triage grading

Source: https://kensaur.us/mushi-mushi/docs/admin/judge

---
title: Triage grading
description: The Triage grading page in the Mushi Mushi console shows how often a second AI agrees with each diagnosis, week by week, and the worst recent disagreements.
---

# Triage grading

**Route:** `/judge` (sidebar: **Triage grading**, under Verify; formerly Judge)

A second AI grades each diagnosis Mushi Mushi makes: was the category right, the
severity, the part of the app, and were the steps to reproduce usable. This page shows
how often it agrees, so you can tell whether to trust a diagnosis before you merge its fix.

**First on the page:** one sentence with this week's score and how often the grader
disagreed **in the last 14 days** (the window is named; an older server without it
gets "so far", all time), with **See disagreements**. Under it, **How often the grader
agrees** draws the weekly agreement share for 12 weeks, and **Worst disagreements,
last 14 days** lists the 3 lowest-scored disagreements with the grader's reason and a
link to each report. `GET /v1/admin/judge/stats` returns `recentWindowDays`,
`recentEvaluations`, `recentDisagreements` and `agreementWeeks` for this.

---

## Tabs

The page has four tabs: **Overview**, **Trend**, **Grades** and **Prompts**.

- **Trend**: **Score trend (12w)** with a bar per dimension (**Accuracy**, **Severity**,
  **Component**, **Repro**), a **Score distribution**, and a **Weekly history** table
  with the week, each dimension and the number of evaluations.
- **Grades**: **Recent evaluations**, one row per graded report with the model, the
  prompt version, each dimension and whether the grader **Agreed**. Tick
  **Disagreements only** to see the misses.
- **Prompts**: the **Prompt leaderboard** with stage, version, status (`active` or
  `candidate`), score, evaluations and traffic share. Click a row to filter Recent
  evaluations to that version.

**Run judge now** grades recent classified reports straight away. It spends AI budget.
Otherwise the judge runs nightly.

---

## Prompt promotion

You edit and A/B test prompts in [AI prompts](/admin/prompt-lab). The nightly judge
run promotes a candidate prompt on its own once it has at least 30 evaluations and its
mean score is more than 5% above the active prompt's.

---

## Drift alerts

When this week's mean score is more than 10% below last week's, the nightly judge run
records a drift alert and, if the project has a Slack webhook set, posts it to Slack.
The **Week change** figure at the top shows the same comparison.

---

## See also

- [Concepts → Judge & self-improvement](/concepts/judge-loop) — how the nightly judge, A/B testing, fine-tune export, and drift detection work together.
- [AI prompts](/admin/prompt-lab) — edit and A/B test the prompts this page grades.
