# Anomaly detection

Source: https://kensaur.us/mushi-mushi/docs/admin/anomalies

---
title: Anomaly detection
---

# Anomaly detection

**Route:** `/anomalies`

The Anomaly detection page applies statistical detectors to time-series metrics you
feed in. When a metric behaves unexpectedly, it surfaces as an anomaly — optionally
auto-filing a report in your project's queue.

---

## Tabs

### Anomalies

Summary stat cards: **Open**, **Confirmed**, **Auto-reported** counts.

The anomaly table shows:

| Column | Description |
|--------|-------------|
| **Metric** | The metric name the detector is watching |
| **Method** | Detection algorithm badge: `Page-Hinkley`, `Z-score`, or `release-regression` |
| **Score** | The anomaly score (higher = more anomalous) |
| **Value** | The observed metric value that triggered the alert |
| **Baseline mean** | The expected value based on history |
| **Detected** | Timestamp |
| **Auto-reported** | Badge if a report was automatically filed |

**Actions:**
- **Confirm** — marks the anomaly as real; updates the confirmed count
- **Dismiss** — marks as false positive and removes from open list

### Metrics

Feed time-series data into the detection pipeline:

| Field | Description |
|-------|-------------|
| **Metric name** | Identifier for the series (e.g. `checkout_errors`, `p95_latency`) |
| **Value** | Numeric measurement |
| **Timestamp** | ISO datetime (defaults to now) |

After ingesting several data points, a **mini bar chart** appears per metric showing up
to 50 recent values with min/max range.

### Detect

Run a detection pass on demand:

| Field | Description |
|-------|-------------|
| **Metric name** | Optional filter — leave blank to run on all metrics |
| **Lookback hours** | 1–720 hours of history to analyse |

Click **Run detection** to trigger the detection pass. The result shows the count of
new anomalies found.

---

## Detection methods

| Method | Best for |
|--------|----------|
| **Page-Hinkley** | Gradual drift in a running mean (e.g. slowly rising error rate) |
| **Z-score** | Sudden spikes above a rolling standard deviation band |
| **release-regression** | Metrics that changed significantly around a deploy timestamp |

---

## Auto-reporting

If a confirmed anomaly exceeds a severity threshold, Mushi automatically creates a
report in the Reports queue. This closes the loop: anomalies become actionable items
without requiring manual review.

---

## API

```bash
# List anomalies
GET /v1/admin/anomalies?project_id=&limit=100

# Ingest a metric data point
POST /v1/admin/metric-series
{ "project_id": "", "metric_name": "p95_latency", "value": 1240, "ts": "2026-05-19T12:00:00Z" }

# Run detection
POST /v1/admin/anomalies/detect
{ "project_id": "", "lookback_hours": 24 }

# Confirm / dismiss
PATCH /v1/admin/anomalies/
{ "status": "confirmed" }
```

---

## Related pages

- [Reports](/admin/reports) — auto-filed anomaly reports appear here
- [Intelligence reports](/admin/intelligence) — weekly digest includes anomaly trends
- [Experiments](/admin/experiments) — A/B test changes that might affect your metrics
