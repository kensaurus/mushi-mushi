# Judge & self-improvement

Source: https://kensaur.us/mushi-mushi/docs/concepts/judge-loop

---
title: Judge & self-improvement
description: How Mushi Mushi checks and tunes its classifier. A nightly judge scores diagnoses, candidate prompts are A/B tested, and a week-over-week drop raises an alert.
---

# Judge & self-improvement

Mushi Mushi doesn't ship a static prompt. The classifier is checked and tuned
through four loops: a nightly judge, prompt A/B testing, fine-tune export, and
drift detection.

---

## 1. Judge

`judge-batch` runs nightly on up to `judge_sample_size` (default 50) of the
newest classified reports that have not been judged yet. A separate judge call
(Claude Sonnet 5.5 by default, overridable with `project_settings.judge_model`,
with OpenAI GPT-5.4 as fallback) scores every component independently, then
combines them into a composite score.

The composite lands on `reports.judge_score` and persists in
`classification_evaluations` for audit. The [Judge dashboard](/admin/judge)
surfaces the trailing 30-day mean, per-component breakdowns, and A/B experiment
status.

---

## 2. Prompt A/B testing

Each classification stage carries a `stage1_prompt_version` and
`stage2_prompt_version`. A candidate prompt runs on the traffic share set on its
`prompt_versions` row (`traffic_percentage`, 0 by default).

Promotion is automatic when:

- the candidate has at least **30** judge evaluations, and
- its mean judge score is more than **5%** higher than the active prompt's.

There is no confidence-interval test yet; the 30-evaluation floor is the only
guard against a lucky streak.

All counters are project-scoped — your prompts never leak into another project's
A/B experiment.

  You can override the traffic slice, minimum sample size, and confidence threshold
  per-project in **Settings → Classification → A/B testing**.

---

## 3. Fine-tune export

The Fine-Tuning page exports the best-scoring classifications, validates the
resulting model against an offline eval harness, and promotes the winner with
a single click.

Validation runs an offline benchmark and refuses to promote a candidate whose
judge mean is below the current production prompt's mean. If the candidate
loses, the UI offers **Reject** with a one-line reason that's archived for
future tuning runs.

---

## 4. Drift detection

After each run, `judge-batch` compares this week's mean judge score with last
week's (`weekly_judge_scores`). If it dropped by more than **10%**, it posts a
"Classification drift alert" to the project's Slack webhook. This is an early
signal that a model update or prompt change has made diagnoses worse.

| Signal | Threshold | Action |
| ------ | --------- | ------ |
| Weekly mean drop | > 10% vs. the previous week | Slack drift alert |
| Candidate A/B win | ≥ 30 evaluations and > 5% higher mean | Auto-promote candidate |
| Fine-tune validation | Must beat production mean | Promote or reject |

---

## See also

- [Admin → Judge dashboard](/admin/judge) — live 30-day mean, per-component scores, active A/B experiments.
- [Admin → Fine-tuning](/admin/fine-tuning) — step-by-step pipeline UI.
- [Concepts → Classification pipeline](/concepts/classification) — how reports are classified before the judge scores them.
