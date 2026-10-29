# Unusual spikes

Source: https://kensaur.us/mushi-mushi/docs/admin/anomalies

---
title: Unusual spikes
description: The Unusual spikes view in the Mushi Mushi console runs statistical detectors on your metrics and files a bug report when a spike starts right after a release.
---

# Unusual spikes

**Route:** `/health?view=spikes` (**Mushi health → Unusual spikes**). The old `/anomalies`
link redirects there. Until October 2026 this was its own page, called Anomaly detection.

**First on the page:** one sentence on the spikes to confirm or dismiss. Once metrics
arrive, **Your metrics, with releases and spikes** draws each metric over time (those
with an open spike first, up to three) with a dashed line per release and a dot per
spike, and **Confirm** / **Dismiss** under the chart. With no metrics yet the page is
one **Add metrics** step. The detectors read **Sudden jump** (z-score), **Slow drift**
(Page-Hinkley) and **Started with a release**.

Mushi Mushi applies statistical detectors to the time-series metrics you send, every
hour and whenever you click **Check now**. When a metric behaves unexpectedly, it shows
up as a spike. A spike that starts right after a release also files a bug report.

---

## Tabs

The tabs are **Summary**, **Spikes** and **Metrics**.

### Spikes

The summary counts include **Spikes to review**, **After a release**, **High score**,
**Auto-reported**, **Metrics watched** and **Dismissed**.

The spike table shows:

| Column | Description |
|--------|-------------|
| **Metric** | The metric name the detector is watching |
| **Method** | Detection algorithm badge: `Page-Hinkley`, `Z-score`, or `release-regression` |
| **Score** | The anomaly score (higher = more anomalous) |
| **Value** | The observed metric value that triggered the alert |
| **Baseline** | The expected value based on history (mean) |
| **Detected** | Timestamp |

**Actions:**
- **Confirm**: marks the spike as real
- **Dismiss**: marks it as noise and removes it from the open list

### Metrics

Feed time-series data into the detection pipeline:

| Field | Description |
|-------|-------------|
| **Metric name** | Identifier for the series (e.g. `checkout_errors`, `p95_latency`) |
| **Value** | Numeric measurement |
| **Timestamp** | Date and time (defaults to now) |

Click **Ingest** to store the value. After several data points, a **mini bar chart**
appears per metric showing up to 50 recent values with min/max range.

### Check now

The **Spikes** tab has a card to run a detection pass on demand:

| Field | Description |
|-------|-------------|
| **Metric name** | Optional filter — leave blank to run on all metrics |
| **Lookback (hours)** | 1 to 720 hours of history to analyse (starts at 48) |

Click **Check now** to run the detection pass. The result shows the count of
new anomalies found.

---

## Detection methods

| Method (label in the chart) | Best for |
|--------|----------|
| **Page-Hinkley** (Slow drift) | Gradual drift in a running mean (e.g. slowly rising error rate) |
| **Z-score** (Sudden jump) | Sudden spikes above a rolling standard deviation band |
| **release-regression** (Started with a release) | Metrics that changed significantly right after a release |

---

## Auto-reporting

When a spike is a **release regression** (it started right after a release), Mushi
creates a bug report in **Bugs** with severity `high` and category `regression`, and
marks the spike confirmed. Other spikes wait for you to confirm or dismiss them.

---

## API

```bash
# List anomalies
GET /v1/admin/anomalies?project_id=<pid>&limit=100

# Ingest a metric data point
POST /v1/admin/metric-series
{ "project_id": "<pid>", "metric_name": "p95_latency", "value": 1240, "ts": "2026-05-19T12:00:00Z" }

# Run detection
POST /v1/admin/anomalies/detect
{ "project_id": "<pid>", "lookback_hours": 24 }

# Confirm / dismiss
PATCH /v1/admin/anomalies/<id>
{ "status": "confirmed" }
```

---

## Related pages

- [Bugs](/admin/reports) — auto-filed regression reports appear here
- [Releases](/admin/releases) — the releases drawn on each metric chart
- [Experiments](/admin/experiments) — A/B test changes that might affect your metrics
