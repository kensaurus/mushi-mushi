# Judge & self-improvement

Source: https://kensaur.us/mushi-mushi/docs/concepts/judge-loop

---
title: Judge & self-improvement
---

# Judge & self-improvement

Mushi doesn't ship a static prompt. The classifier improves continuously through
four interlocking loops — a nightly judge, prompt A/B testing, fine-tune export,
and drift detection.

---

## 1. Judge

`judge-batch` runs nightly on a sample of yesterday's classifications. A separate
**judge model** — by default a different family from the classifier (Anthropic Sonnet
judging Anthropic Haiku, with OpenAI gpt-4o as fallback) — scores every component
independently, then combines them into a composite score.

The composite lands on `reports.judge_score` and persists in
`classification_evaluations` for audit. The [Judge dashboard](/admin/judge)
surfaces the trailing 30-day mean, per-component breakdowns, and A/B experiment
status.

---

## 2. Prompt A/B testing

Each classification stage carries a `stage1_prompt_version` and
`stage2_prompt_version`. The candidate prompt runs on a **5% traffic slice**
for a configurable window.

Promotion is automatic when:

- The candidate's mean judge score beats the active baseline by **≥ 0.05**
- The 95% confidence interval **does not include zero**

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

If yesterday's mean composite score drops **> 0.10** vs. the trailing 7-day mean,
`judge-batch` posts a `judge.drift` Slack alert. This is the first signal that
an upstream model update or prompt regression has degraded classification quality
— before any user or reviewer notices the difference.

| Signal | Threshold | Action |
| ------ | --------- | ------ |
| Daily mean drop | > 0.10 vs. 7-day mean | `judge.drift` Slack alert |
| Candidate A/B win | ≥ 0.05 at 95% CI | Auto-promote candidate |
| Fine-tune validation | Must beat production mean | Promote or reject |

---

## See also

- [Admin → Judge dashboard](/admin/judge) — live 30-day mean, per-component scores, active A/B experiments.
- [Admin → Fine-tuning](/admin/fine-tuning) — step-by-step pipeline UI.
- [Concepts → Classification pipeline](/concepts/classification) — how reports are classified before the judge scores them.
