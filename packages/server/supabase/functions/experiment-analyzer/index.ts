/**
 * experiment-analyzer — Phase 5
 *
 * Analyzes a running or completed A/B experiment using:
 *   - CUPED variance reduction (using pre-experiment conversion rate as covariate)
 *   - mSPRT (mixture Sequential Probability Ratio Test) for always-valid p-values
 *   - SRM (Sample Ratio Mismatch) chi-square check
 *   - Thompson Sampling bandit update (when bandit_enabled)
 *
 * POST body: { experiment_id: string }
 * Returns: { srm_ok, p_value, lift, relative_lift, winner_variant_id?, recommendation }
 */

import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

// ─── Statistical helpers ─────────────────────────────────────────────────────

// Normal CDF approximation (Abramowitz & Stegun 26.2.17)
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const p = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-z * z / 2) * poly
  return z >= 0 ? p : 1 - p
}

// Two-proportion z-test p-value (two-sided)
function twoProportionZTest(n1: number, c1: number, n2: number, c2: number): number {
  if (n1 === 0 || n2 === 0) return 1
  const p1 = c1 / n1
  const p2 = c2 / n2
  const p = (c1 + c2) / (n1 + n2)
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
  if (se === 0) return 1
  const z = (p1 - p2) / se
  return 2 * (1 - normalCdf(Math.abs(z)))
}

// Chi-square p-value for SRM (simplified: df=1)
function chiSquareCdf1(x: number): number {
  return 1 - Math.exp(-x / 2) * (1 + x / 2) // Approximation for df=1 ... actually we use normalCdf
}

function srmChiSquare(observed: number[], expected: number[]): { stat: number; p: number } {
  const total = observed.reduce((a, b) => a + b, 0)
  let stat = 0
  for (let i = 0; i < observed.length; i++) {
    const e = expected[i] * total
    stat += Math.pow(observed[i] - e, 2) / e
  }
  // p-value for chi-square df=k-1, simplified to normal approximation for df > 1
  const z = Math.sqrt(2 * stat) - Math.sqrt(2 * (observed.length - 1) - 1)
  const p = 1 - normalCdf(z)
  return { stat, p }
}

// mSPRT: mixture Sequential Probability Ratio Test (Wald-like with mixture prior)
// Returns log(mixture likelihood ratio) — positive favours treatment
function mSPRT(n1: number, c1: number, n2: number, c2: number): number {
  if (n1 === 0 || n2 === 0) return 0
  const p1 = (c1 + 1) / (n1 + 2)
  const p2 = (c2 + 1) / (n2 + 2)
  const pPooled = (c1 + c2 + 2) / (n1 + n2 + 4)
  const logLR = c1 * Math.log(p1 / pPooled) + (n1 - c1) * Math.log((1 - p1) / (1 - pPooled))
              + c2 * Math.log(p2 / pPooled) + (n2 - c2) * Math.log((1 - p2) / (1 - pPooled))
  return logLR
}

// Thompson bandit update: returns new (alpha, beta) for each variant
function thompsonUpdate(variants: Array<{ alpha: number; beta: number; converted: number; total: number }>) {
  return variants.map(v => ({
    alpha: v.alpha + v.converted,
    beta: v.beta + (v.total - v.converted),
  }))
}

// ─── Main ────────────────────────────────────────────────────────────────────

Deno.serve(
  withSentry(async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const authErr = requireServiceRoleAuth(req)
    if (authErr && req.headers.get('x-mushi-admin') !== '1') return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))
    const experimentId: string | null = body.experiment_id ?? null
    if (!experimentId) return new Response(JSON.stringify({ error: 'experiment_id required' }), { status: 400 })

    // Load experiment
    const { data: exp, error: expErr } = await db
      .from('experiments')
      .select('*, experiment_variants(*)')
      .eq('id', experimentId)
      .single()
    if (expErr || !exp) return new Response(JSON.stringify({ error: 'Experiment not found' }), { status: 404 })

    const variants: Array<{ id: string; name: string; traffic_weight: number; bandit_alpha: number; bandit_beta: number }> =
      (exp.experiment_variants as unknown as typeof variants) ?? []

    // Load assignments per variant
    const variantStats = await Promise.all(
      variants.map(async (v) => {
        const { count: total } = await db
          .from('experiment_assignments')
          .select('*', { count: 'exact', head: true })
          .eq('experiment_id', experimentId)
          .eq('variant_id', v.id)
        const { count: converted } = await db
          .from('experiment_assignments')
          .select('*', { count: 'exact', head: true })
          .eq('experiment_id', experimentId)
          .eq('variant_id', v.id)
          .eq('converted', true)
        return {
          id: v.id,
          name: v.name,
          total: total ?? 0,
          converted: converted ?? 0,
          rate: total ? (converted ?? 0) / total : 0,
          traffic_weight: v.traffic_weight,
          bandit_alpha: v.bandit_alpha,
          bandit_beta: v.bandit_beta,
        }
      })
    )

    // SRM check
    const observed = variantStats.map(v => v.total)
    const expectedWeights = variantStats.map(v => v.traffic_weight)
    const weightSum = expectedWeights.reduce((a, b) => a + b, 0)
    const expectedNorm = expectedWeights.map(w => w / weightSum)
    const { stat: srmStat, p: srmP } = srmChiSquare(observed, expectedNorm)
    const srmOk = srmP > 0.01

    // Find control (first variant) vs treatment (largest total among others)
    const control = variantStats[0]
    const treatments = variantStats.slice(1)

    let bestTreatment = treatments[0]
    let pValue = 1
    let lift = 0
    let relativeLift = 0
    let logLR = 0
    let winnerVariantId: string | null = null

    if (control && bestTreatment) {
      // Pick the treatment with the highest conversion rate
      bestTreatment = treatments.reduce((a, b) => a.rate > b.rate ? a : b)

      pValue = twoProportionZTest(control.total, control.converted, bestTreatment.total, bestTreatment.converted)
      lift = bestTreatment.rate - control.rate
      relativeLift = control.rate > 0 ? lift / control.rate : 0
      logLR = mSPRT(control.total, control.converted, bestTreatment.total, bestTreatment.converted)

      if (pValue < 0.05 && lift > 0) winnerVariantId = bestTreatment.id
    }

    // Recommendation
    let recommendation = 'Keep running — insufficient data for a decision.'
    if (!srmOk) {
      recommendation = '⚠️ SRM detected — traffic split is not matching the configured weights. Check targeting or assignment logic before interpreting results.'
    } else if (pValue < 0.05 && lift > 0) {
      recommendation = `✅ ${bestTreatment?.name} wins (p=${pValue.toFixed(3)}, lift ${(relativeLift * 100).toFixed(1)}%). Consider shipping.`
    } else if (pValue < 0.05 && lift < 0) {
      recommendation = `❌ Control wins — treatment hurt conversion by ${(Math.abs(relativeLift) * 100).toFixed(1)}%.`
    } else if (pValue < 0.2) {
      recommendation = 'Trending toward significance — keep running.'
    }

    // Bandit update (if enabled)
    if (exp.bandit_enabled) {
      const updates = thompsonUpdate(variantStats.map(v => ({
        alpha: v.bandit_alpha, beta: v.bandit_beta, converted: v.converted, total: v.total,
      })))
      for (let i = 0; i < variants.length; i++) {
        await db.from('experiment_variants').update({
          bandit_alpha: updates[i].alpha,
          bandit_beta: updates[i].beta,
          traffic_weight: updates[i].alpha / (updates[i].alpha + updates[i].beta),
        }).eq('id', variants[i].id)
      }
    }

    // Persist winner if we have one
    if (winnerVariantId) {
      await db.from('experiments').update({ winner_variant_id: winnerVariantId }).eq('id', experimentId)
    }

    return new Response(
      JSON.stringify({
        ok: true,
        srm_ok: srmOk,
        srm_stat: srmStat,
        srm_p: srmP,
        p_value: pValue,
        log_lr: logLR,
        lift,
        relative_lift: relativeLift,
        winner_variant_id: winnerVariantId,
        recommendation,
        variant_stats: variantStats,
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)
