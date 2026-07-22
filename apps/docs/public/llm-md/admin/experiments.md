# Experiments

Source: https://kensaur.us/mushi-mushi/docs/admin/experiments

---
title: Experiments
---

# Experiments

**Route:** `/experiments`

The Experiments page lets you define A/B tests, launch them, collect results, and run
statistical analysis (CUPED variance reduction + mSPRT sequential testing) to determine
a winner without a fixed sample size.

---

## Tabs

### Experiments

Summary stat cards: **Total**, **Running**, **Winners found**.

The experiments table shows:

| Column | Description |
|--------|-------------|
| **Name** | Experiment label |
| **Hypothesis** | Truncated hypothesis text |
| **Status** | `draft`, `running`, `stopped` badge |
| **Variants** | Count of configured variants |
| **Bandit mode** | Badge if Thompson Sampling is enabled |
| **Created** | Timestamp |

**Actions:** **Launch** (draft), **Stop** (running), **View** (opens drawer).

### New

Create a new experiment:

| Field | Description |
|-------|-------------|
| **Name** | Short experiment label |
| **Hypothesis** | What you expect to observe and why |
| **Bandit mode** | Enables Thompson Sampling — automatically reallocates traffic to better-performing variants |
| **Variants** | Add variants with a name and traffic weight. At least two required. |

---

## Experiment detail drawer

Opens on **View**. Shows:
- Status, bandit enabled, and winner badges
- **Hypothesis** text
- **Variants** list — each with traffic weight, Thompson Sampling α/β parameters, and a **winner** highlight if analysis identified it
- **Launch** / **Stop** / **Analyze** buttons

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
GET /v1/admin/experiments?project_id=

# Create
POST /v1/admin/experiments
{ "name": "...", "hypothesis": "...", "bandit_enabled": false, "project_id": "" }

# Add a variant
POST /v1/admin/experiments//variants
{ "name": "Variant B", "traffic_weight": 0.5 }

# Launch / Stop
POST /v1/admin/experiments//launch
POST /v1/admin/experiments//stop

# Analyze
POST /v1/admin/experiments//analyze
```

---

## Related pages

- [Anomaly detection](/admin/anomalies) — detect metric shifts caused by experiment variants
- [Judge dashboard](/admin/judge) — A/B test classifier prompt versions
- [Intelligence reports](/admin/intelligence) — experiment results appear in the weekly digest
