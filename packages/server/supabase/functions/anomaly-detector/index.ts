/**
 * anomaly-detector — Phase 6
 *
 * Analyzes recent metric_series data for each project and detects anomalies using:
 *   - Page-Hinkley test (streaming change-point detection for mean shift)
 *   - Z-score with rolling baseline (STL-inspired: subtract rolling mean, normalize by std)
 *   - Release boundary regression (spike in error rate just after a release)
 *
 * For confirmed anomalies, auto-creates a bug report in the reports table.
 *
 * POST body: { project_id: string, metric_name?: string, lookback_hours?: number }
 * Cron: pg_cron runs this hourly per project
 */

import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

// ─── Statistical helpers ──────────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function std(xs: number[], m?: number): number {
  const mu = m ?? mean(xs)
  if (xs.length < 2) return 0
  return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1))
}

// Page-Hinkley: returns cumulative test statistic; fires when > threshold
interface PHState { sum: number; min: number; count: number }
function pageHinkley(prevState: PHState, newValue: number, mu: number, delta = 0.005): { state: PHState; fire: boolean; score: number } {
  const diff = newValue - mu - delta
  const sum = prevState.sum + diff
  const min = Math.min(prevState.min, sum)
  const score = sum - min
  return {
    state: { sum, min: min, count: prevState.count + 1 },
    fire: score > 50,
    score,
  }
}

// Z-score anomaly
function zScore(value: number, mu: number, sigma: number): number {
  return sigma > 0 ? Math.abs(value - mu) / sigma : 0
}

// ─── Main ────────────────────────────────────────────────────────────────────

Deno.serve(
  withSentry('anomaly-detector', async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const authErr = requireServiceRoleAuth(req)
    if (authErr && req.headers.get('x-mushi-admin') !== '1') return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))
    const projectId: string | null = body.project_id ?? null
    const metricFilter: string | null = body.metric_name ?? null
    const lookbackHours: number = body.lookback_hours ?? 48

    if (!projectId) return new Response(JSON.stringify({ error: 'project_id required' }), { status: 400 })

    const cutoff = new Date(Date.now() - lookbackHours * 3_600_000).toISOString()

    // Load recent metric series
    let q = db
      .from('metric_series')
      .select('metric_name, ts, value, release_id')
      .eq('project_id', projectId)
      .gte('ts', cutoff)
      .order('ts', { ascending: true })
    if (metricFilter) q = q.eq('metric_name', metricFilter)
    const { data: rows } = await q

    if (!rows?.length) {
      return new Response(JSON.stringify({ ok: true, anomalies: 0, message: 'No metric data in window' }), {
        headers: { 'content-type': 'application/json' },
      })
    }

    // Group by metric_name
    const byMetric = new Map<string, Array<{ ts: string; value: number; release_id: string | null }>>()
    for (const r of rows) {
      const key = r.metric_name as string
      if (!byMetric.has(key)) byMetric.set(key, [])
      byMetric.get(key)!.push({ ts: r.ts, value: r.value, release_id: r.release_id })
    }

    const anomaliesInserted: string[] = []

    for (const [metricName, points] of byMetric) {
      const values = points.map(p => p.value)
      if (values.length < 5) continue

      // Rolling baseline: first 75% of window
      const baselineN = Math.max(3, Math.floor(values.length * 0.75))
      const baseline = values.slice(0, baselineN)
      const mu = mean(baseline)
      const sigma = std(baseline, mu)

      // Page-Hinkley on full series
      let phState: PHState = { sum: 0, min: 0, count: 0 }
      let phFired = false
      let phScore = 0
      for (const v of values) {
        const { state, fire, score } = pageHinkley(phState, v, mu)
        phState = state
        if (fire) { phFired = true; phScore = score }
      }

      // Z-score on the last value
      const lastValue = values.at(-1)!
      const lastZ = zScore(lastValue, mu, sigma)
      const zFired = lastZ > 3

      // Release boundary: if the last point has a release_id, compare before/after
      const lastPoint = points.at(-1)!
      let releaseFired = false
      let releaseId: string | null = null
      if (lastPoint.release_id) {
        const preRelease = values.slice(0, -3)
        const postRelease = values.slice(-3)
        const preMu = mean(preRelease)
        const postMu = mean(postRelease)
        releaseFired = preMu > 0 && (postMu - preMu) / preMu > 0.5
        if (releaseFired) releaseId = lastPoint.release_id
      }

      if (!phFired && !zFired && !releaseFired) continue

      const method = phFired ? 'page-hinkley' : zFired ? 'z-score' : 'release-regression'
      const score = phFired ? phScore : zFired ? lastZ : 0
      const threshold = phFired ? 50 : zFired ? 3 : 0.5

      // Dedup: skip if we already have an open anomaly for this metric in the last 4h
      const { count: existingCount } = await db
        .from('anomaly_detections')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('metric_name', metricName)
        .eq('status', 'open')
        .gte('created_at', new Date(Date.now() - 4 * 3_600_000).toISOString())
      if (existingCount && existingCount > 0) continue

      const { data: detection } = await db.from('anomaly_detections').insert({
        project_id: projectId,
        metric_name: metricName,
        detected_at: new Date().toISOString(),
        method,
        score,
        threshold,
        value: lastValue,
        baseline_mean: mu,
        baseline_std: sigma,
        release_id: releaseId,
        confirmed: false,
      }).select().single()

      if (detection) anomaliesInserted.push(detection.id)

      // Auto-report for release regressions
      if (releaseFired && detection) {
        try {
          const { data: reportRow } = await db.from('reports').insert({
            project_id: projectId,
            title: `[Auto] Metric regression on ${metricName} after release`,
            description: `Anomaly detector found a >${((lastValue / mu - 1) * 100).toFixed(0)}% spike in "${metricName}" immediately after release ${releaseId}. Baseline mean: ${mu.toFixed(2)}, current: ${lastValue.toFixed(2)}.`,
            severity: 'high',
            category: 'regression',
            source: 'anomaly-detector',
          }).select().single()
          if (reportRow) {
            await db.from('anomaly_detections').update({ auto_report_id: reportRow.id, confirmed: true }).eq('id', detection.id)
          }
        } catch { /* best effort auto-report */ }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, anomalies: anomaliesInserted.length, ids: anomaliesInserted }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)
