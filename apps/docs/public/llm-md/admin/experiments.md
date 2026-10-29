# Experiments

Source: https://kensaur.us/mushi-mushi/docs/admin/experiments

---
title: Experiments
description: The Experiments page in the Mushi Mushi console defines and runs A/B tests on your app and analyses them with CUPED variance reduction and sequential testing.
---

# Experiments

**Route:** `/experiments` (a Lab: under **More pages** in the sidebar unless you keep it there)

The Experiments page in Mushi Mushi lets you define A/B tests, launch them, collect results, and run
statistical analysis (CUPED variance reduction + mSPRT sequential testing) to determine
a winner without a fixed sample size.

---

## Tabs

The tabs are **Summary**, **Experiments** and **New**. The summary counts include
**Total**, **Running**, **Ready to launch** and **Winners**.

### Experiments

The experiments table shows:

| Column | Description |
|--------|-------------|
| **Name** | Experiment label |
| **Status** | `Draft`, `Running`, `Stopped` or `Completed` |
| **Variants** | Count of configured variants |
| **Split** | **Shifts to winner** when bandit mode is on, otherwise **Even split** |
| **Created** | Timestamp |

**Actions:** **Launch** (draft) and **Stop** (running). Click a row to open the drawer.

### New

Create a new experiment, then click **Create experiment**:

| Field | Description |
|-------|-------------|
| **Name** | Short experiment label (required) |
| **Hypothesis** | What you expect to observe and why |
| **Send more users to the version that is winning** | Bandit mode: Thompson Sampling moves traffic toward better-performing variants |
| **Variants** | A name and a **Weight (0–1)** for each. Two to start; **+ Add variant** adds more. |

---

## Experiment detail drawer

Opens when you click a row. Shows:
- Status, **Shifts to winner** and **Winner found** badges
- **Hypothesis** text
- **Variants** list — each with traffic weight, Thompson Sampling α/β parameters, and a **winner** highlight if analysis identified it
- **Launch** / **Stop** / **Analyze** buttons, **Add variant**, and **Delete draft** for a draft

### Analysis results

Click **Analyze** to run the statistical analysis. Results show:
- **SRM check** — sample ratio mismatch detector (flags if traffic split is off)
- **p-value** — classical significance
- **mSPRT log-LR** — sequential test log-likelihood ratio (valid at any sample size)
- **Relative lift** — % improvement vs. control
- **Recommendation** — plain-English verdict
- **Per-variant stats table** — conversions, exposures, rate

mSPRT (mixture Sequential Probability Ratio Test) lets you analyze results at any
time — you don't need to pre-commit to a sample size. This prevents the "peeking problem"
common in fixed-horizon tests.

---

## Bandit mode (Thompson Sampling)

When bandit mode is enabled, traffic weights are updated continuously based on observed
performance. The `α` (successes + 1) and `β` (failures + 1) parameters for each variant
are shown in the experiment drawer. Better-performing variants receive more traffic
automatically.

---

## API

```bash
# List experiments
GET /v1/admin/experiments?project_id=<pid>

# Create
POST /v1/admin/experiments
{ "name": "...", "hypothesis": "...", "bandit_enabled": false, "project_id": "<pid>" }

# Add a variant
POST /v1/admin/experiments/<id>/variants
{ "name": "Variant B", "traffic_weight": 0.5 }

# Launch / Stop
POST /v1/admin/experiments/<id>/launch
POST /v1/admin/experiments/<id>/stop

# Analyze
POST /v1/admin/experiments/<id>/analyze
```

---

## Related pages

- [Unusual spikes](/admin/anomalies) — detect metric shifts caused by experiment variants
- [AI prompts](/admin/prompt-lab) — A/B test the prompts behind Mushi Mushi's own AI steps (a separate feature)
