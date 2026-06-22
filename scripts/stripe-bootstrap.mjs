#!/usr/bin/env node
// FILE: scripts/stripe-bootstrap.mjs
// PURPOSE: Idempotently provision the Stripe Billing objects Mushi Mushi Cloud
//          needs — meters, metered overage prices, and (optionally) re-create
//          the flat tier prices if they're missing. Safe to re-run.
//
// What it creates (all live in the Stripe account named in `account` field of
// `get_stripe_account_info`):
//
//   Phase 2 (current) — diagnoses-metered tiers:
//   1. Billing Meters
//      - mushi_reports_ingested  (SUM, payload key: stripe_customer_id)  ← kept as audit dual-meter
//      - mushi_fixes_succeeded   (SUM, payload key: stripe_customer_id)
//      - mushi_diagnoses         (SUM, payload key: stripe_customer_id)  ← new billing unit
//   2. Products
//      - Mushi Mushi — Indie           (new $15/mo tier)
//      - Mushi Mushi — Pro             (repriced to $49/mo)
//      - Mushi Mushi — Diagnoses overage  (per-diagnosis overage for Indie + Pro)
//   3. Prices (find-or-create by lookup_key)
//      Flat monthly:
//        mushi:indie:base:v1             $15.00/mo  → plan_id=indie
//        mushi:pro:base:v2               $49.00/mo  → plan_id=pro  (new subs; existing on :v1)
//      Metered overage (diagnoses meter):
//        mushi:diagnoses:overage:indie:v1  $0.030000/diagnosis  → Indie
//        mushi:diagnoses:overage:pro:v1    $0.025000/diagnosis  → Pro
//      Legacy (kept for existing subscribers — not removed):
//        mushi:starter:base:v1             $19.00/mo
//        mushi:pro:base:v1                 $99.00/mo  (legacy)
//        mushi:reports:overage:starter:v1  $0.0025/report
//        mushi:reports:overage:pro:v1      $0.0020/report
//
// Idempotency is enforced via Stripe's `lookup_key` on prices and our own
// dedup of meter `event_name`s — re-running the script is a no-op once
// everything is provisioned.
//
// Output: writes `STRIPE_*` env block to stdout. Pipe into your secret store
// (Vercel / Supabase / 1Password) — the script never writes to disk.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-bootstrap.mjs
//   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-bootstrap.mjs   # test mode
//
// Other projects on the same Stripe account are NOT touched — every object
// carries the prefix `Mushi Mushi —` (products) or `mushi:` (lookup keys) and
// `metadata.project = mushi-mushi`. The script greps Stripe by prefix before
// creating anything.

import process from 'node:process'

const STRIPE_API = 'https://api.stripe.com/v1'
const SECRET = process.env.STRIPE_SECRET_KEY
if (!SECRET) {
  console.error('STRIPE_SECRET_KEY is required (sk_live_… or sk_test_…)')
  process.exit(1)
}
const MODE = SECRET.startsWith('sk_live_') ? 'live' : 'test'

// ----------------------------------------------------------------
// Tiny wrapper around Stripe's REST API. Form-urlencoded body,
// nested fields use `parent[child]` keys (Stripe convention).
// ----------------------------------------------------------------
function encode(obj, prefix = '') {
  const parts = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (typeof v === 'object' && !Array.isArray(v)) {
      parts.push(encode(v, key))
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object') parts.push(encode(item, `${key}[${i}]`))
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)
      })
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
    }
  }
  return parts.filter(Boolean).join('&')
}

async function stripe(path, opts = {}) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2025-08-27.basil',
    },
    body: opts.body ? encode(opts.body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try { detail = JSON.stringify(JSON.parse(text), null, 2) } catch {}
    throw new Error(`stripe ${opts.method ?? 'GET'} ${path} → ${res.status}\n${detail}`)
  }
  return text ? JSON.parse(text) : {}
}

// ----------------------------------------------------------------
// 1. Billing Meters — find-or-create by `event_name`
// ----------------------------------------------------------------
const METERS = [
  {
    display_name: 'Mushi reports ingested',
    event_name: 'mushi_reports_ingested',
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    default_aggregation: { formula: 'sum' },
    value_settings: { event_payload_key: 'value' },
  },
  {
    display_name: 'Mushi fixes succeeded',
    event_name: 'mushi_fixes_succeeded',
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    default_aggregation: { formula: 'sum' },
    value_settings: { event_payload_key: 'value' },
  },
  // Phase 2 — diagnoses is the new primary billing unit. Runs in parallel with
  // reports_ingested for one billing cycle, then reports_ingested retires as
  // a free audit event.
  {
    display_name: 'Mushi diagnoses',
    event_name: 'mushi_diagnoses',
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    default_aggregation: { formula: 'sum' },
    value_settings: { event_payload_key: 'value' },
  },
]

async function findOrCreateMeter(spec) {
  const list = await stripe(`/billing/meters?limit=100`)
  const existing = (list.data ?? []).find((m) => m.event_name === spec.event_name)
  if (existing) {
    log(`meter exists: ${spec.event_name} → ${existing.id}`)
    return existing
  }
  const created = await stripe('/billing/meters', { method: 'POST', body: spec })
  log(`meter created: ${spec.event_name} → ${created.id}`)
  return created
}

// ----------------------------------------------------------------
// 2. Prices — find-or-create by `lookup_key` so re-runs are no-ops
// ----------------------------------------------------------------
async function findPriceByLookupKey(lookupKey) {
  const res = await stripe(
    `/prices/search?query=${encodeURIComponent(`lookup_key:'${lookupKey}'`)}&limit=1`,
  )
  return res.data?.[0] ?? null
}

async function findOrCreatePrice(spec) {
  const existing = await findPriceByLookupKey(spec.lookup_key)
  if (existing) {
    log(`price exists: ${spec.lookup_key} → ${existing.id}`)
    return existing
  }
  const created = await stripe('/prices', { method: 'POST', body: spec })
  log(`price created: ${spec.lookup_key} → ${created.id}`)
  return created
}

async function findProductByName(name) {
  const list = await stripe(`/products?limit=100&active=true`)
  return (list.data ?? []).find((p) => p.name === name) ?? null
}

// ----------------------------------------------------------------
// Util
// ----------------------------------------------------------------
const log = (msg) => process.stderr.write(`  ${msg}\n`)
const heading = (msg) => process.stderr.write(`\n${msg}\n`)

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------
async function main() {
  heading(`Bootstrapping Mushi Mushi Stripe objects (${MODE} mode)…`)

  // ------------------- Meters -------------------
  heading('1/3  Billing Meters')
  const reportsMeter = await findOrCreateMeter(METERS[0])
  const fixesMeter = await findOrCreateMeter(METERS[1])
  const diagnosesMeter = await findOrCreateMeter(METERS[2])

  // ------------------- Products -------------------
  heading('2/3  Products')
  const products = {
    indie: await findProductByName('Mushi Mushi — Indie'),
    starter: await findProductByName('Mushi Mushi — Starter'),
    pro: await findProductByName('Mushi Mushi — Pro'),
    reportsOverage: await findProductByName('Mushi Mushi — Reports overage'),
    successfulFixes: await findProductByName('Mushi Mushi — Successful fixes'),
    diagnosesOverage: await findProductByName('Mushi Mushi — Diagnoses overage'),
  }
  // Products that are optional (may not exist yet on older setups) — only
  // hard-fail on the core required ones.
  const requiredProducts = ['pro', 'reportsOverage', 'successfulFixes']
  for (const [k, v] of Object.entries(products)) {
    if (!v && requiredProducts.includes(k)) {
      throw new Error(
        `Missing product "${k}" — create it in the Stripe Dashboard named ` +
          `"Mushi Mushi — ${k[0].toUpperCase()}${k.slice(1)}" then re-run.`,
      )
    }
    if (v) log(`product ok: ${v.name} → ${v.id}`)
    else log(`product missing (ok for new setup): Mushi Mushi — ${k}`)
  }

  // Ensure the Indie + Diagnoses overage products exist if they weren't in the
  // Dashboard yet. Uses find-or-create so re-runs are no-ops.
  if (!products.indie) {
    products.indie = await stripe('/products', {
      method: 'POST',
      body: {
        name: 'Mushi Mushi — Indie',
        metadata: { project: 'mushi-mushi', tier: 'indie' },
      },
    })
    log(`product created: ${products.indie.name} → ${products.indie.id}`)
  }
  if (!products.diagnosesOverage) {
    products.diagnosesOverage = await stripe('/products', {
      method: 'POST',
      body: {
        name: 'Mushi Mushi — Diagnoses overage',
        metadata: { project: 'mushi-mushi', kind: 'overage', unit: 'diagnoses' },
      },
    })
    log(`product created: ${products.diagnosesOverage.name} → ${products.diagnosesOverage.id}`)
  }
  if (!products.starter) {
    products.starter = await stripe('/products', {
      method: 'POST',
      body: {
        name: 'Mushi Mushi — Starter',
        metadata: { project: 'mushi-mushi', tier: 'starter', deprecated: 'true' },
      },
    })
    log(`product created (legacy): ${products.starter.name} → ${products.starter.id}`)
  }

  // ------------------- Prices -------------------
  heading('3/3  Prices')

  // ── Legacy prices (kept for existing subscribers — re-run safe no-ops) ──

  // Flat tier prices were created by the MCP in the scaffolding pass; this
  // step is here so the script self-heals if they're ever deleted in
  // dashboard cleanup.
  const starterBase = await findOrCreatePrice({
    product: products.starter.id,
    currency: 'usd',
    unit_amount: 1900,
    lookup_key: 'mushi:starter:base:v1',
    nickname: 'Mushi Mushi Starter — base $19/mo (legacy)',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'licensed' },
    metadata: { project: 'mushi-mushi', tier: 'starter', kind: 'base', version: 'v1', deprecated: 'true' },
  })
  const proBaseV1 = await findOrCreatePrice({
    product: products.pro.id,
    currency: 'usd',
    unit_amount: 9900,
    lookup_key: 'mushi:pro:base:v1',
    nickname: 'Mushi Mushi Pro — base $99/mo (legacy)',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'licensed' },
    metadata: { project: 'mushi-mushi', tier: 'pro', kind: 'base', version: 'v1', deprecated: 'true' },
  })

  // Legacy per-report overage prices (dual-metered during cutover, then retired).
  const starterOverage = await findOrCreatePrice({
    product: products.reportsOverage.id,
    currency: 'usd',
    unit_amount_decimal: '0.25',
    billing_scheme: 'per_unit',
    lookup_key: 'mushi:reports:overage:starter:v1',
    nickname: 'Mushi Mushi reports overage — Starter ($0.0025/report) (legacy)',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'metered', meter: reportsMeter.id },
    metadata: { project: 'mushi-mushi', tier: 'starter', kind: 'overage', version: 'v1', deprecated: 'true' },
  })
  const proOverage = await findOrCreatePrice({
    product: products.reportsOverage.id,
    currency: 'usd',
    unit_amount_decimal: '0.20',
    billing_scheme: 'per_unit',
    lookup_key: 'mushi:reports:overage:pro:v1',
    nickname: 'Mushi Mushi reports overage — Pro ($0.0020/report) (legacy)',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'metered', meter: reportsMeter.id },
    metadata: { project: 'mushi-mushi', tier: 'pro', kind: 'overage', version: 'v1', deprecated: 'true' },
  })

  // ── Phase 2 — diagnoses-metered tiers ────────────────────────────────────

  // Indie $15/mo flat — replaces Starter.
  const indieBase = await findOrCreatePrice({
    product: products.indie.id,
    currency: 'usd',
    unit_amount: 1500,
    lookup_key: 'mushi:indie:base:v1',
    nickname: 'Mushi Mushi Indie — base $15/mo',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'licensed' },
    metadata: { project: 'mushi-mushi', tier: 'indie', kind: 'base', version: 'v1' },
  })

  // Pro $49/mo flat (v2 — down from $99; existing subs stay on v1).
  const proBaseV2 = await findOrCreatePrice({
    product: products.pro.id,
    currency: 'usd',
    unit_amount: 4900,
    lookup_key: 'mushi:pro:base:v2',
    nickname: 'Mushi Mushi Pro — base $49/mo',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'licensed' },
    metadata: { project: 'mushi-mushi', tier: 'pro', kind: 'base', version: 'v2' },
  })

  // Diagnoses overage prices — pegged to the mushi_diagnoses meter.
  // unit_amount_decimal uses sub-cent precision ($0.030 = 3 cents).
  const indieDiagnosesOverage = await findOrCreatePrice({
    product: products.diagnosesOverage.id,
    currency: 'usd',
    unit_amount_decimal: '3.0',
    billing_scheme: 'per_unit',
    lookup_key: 'mushi:diagnoses:overage:indie:v1',
    nickname: 'Mushi Mushi diagnoses overage — Indie ($0.030/diagnosis)',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'metered', meter: diagnosesMeter.id },
    metadata: { project: 'mushi-mushi', tier: 'indie', kind: 'overage', unit: 'diagnoses', version: 'v1' },
  })
  const proDiagnosesOverage = await findOrCreatePrice({
    product: products.diagnosesOverage.id,
    currency: 'usd',
    unit_amount_decimal: '2.5',
    billing_scheme: 'per_unit',
    lookup_key: 'mushi:diagnoses:overage:pro:v1',
    nickname: 'Mushi Mushi diagnoses overage — Pro ($0.025/diagnosis)',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'metered', meter: diagnosesMeter.id },
    metadata: { project: 'mushi-mushi', tier: 'pro', kind: 'overage', unit: 'diagnoses', version: 'v1' },
  })

  // ── Annual billing prices (~2 months free = 10/12 discount) ───────────────
  // Indie annual: $15 × 10 = $150/yr (vs $180)
  const indieAnnual = await findOrCreatePrice({
    product: products.indie.id,
    currency: 'usd',
    unit_amount: 15000,  // $150/yr
    lookup_key: 'mushi:indie:annual:v1',
    nickname: 'Mushi Mushi Indie — annual $150/yr',
    tax_behavior: 'exclusive',
    recurring: { interval: 'year', usage_type: 'licensed' },
    metadata: { project: 'mushi-mushi', tier: 'indie', kind: 'base', billing_period: 'annual', version: 'v1' },
  })

  // Pro annual: $49 × 10 = $490/yr (vs $588)
  const proAnnual = await findOrCreatePrice({
    product: products.pro.id,
    currency: 'usd',
    unit_amount: 49000,  // $490/yr
    lookup_key: 'mushi:pro:annual:v1',
    nickname: 'Mushi Mushi Pro — annual $490/yr',
    tax_behavior: 'exclusive',
    recurring: { interval: 'year', usage_type: 'licensed' },
    metadata: { project: 'mushi-mushi', tier: 'pro', kind: 'base', billing_period: 'annual', version: 'v1' },
  })

  // ------------------- Output env block -------------------
  heading('✓ Bootstrap complete. Add these to your secret store:')
  const envLines = [
    `# --- Stripe (${MODE} mode) — generated ${new Date().toISOString()} ---`,
    ``,
    `# Billing Meter IDs`,
    `STRIPE_METER_REPORTS_ID=${reportsMeter.id}`,
    `STRIPE_METER_FIXES_ID=${fixesMeter.id}`,
    `STRIPE_METER_DIAGNOSES_ID=${diagnosesMeter.id}`,
    ``,
    `# Billing Meter event_name constants (must match usage-aggregator + _shared/stripe.ts)`,
    `STRIPE_METER_REPORTS_EVENT_NAME=mushi_reports_ingested`,
    `STRIPE_METER_FIXES_EVENT_NAME=mushi_fixes_succeeded`,
    `STRIPE_METER_DIAGNOSES_EVENT_NAME=mushi_diagnoses`,
    `# legacy aliases — keep until quota.ts is fully migrated off reports_ingested`,
    `STRIPE_METER_EVENT_NAME=mushi_reports_ingested`,
    ``,
    `# Phase 2 — diagnoses-metered tier prices (use for new Checkout Sessions)`,
    `STRIPE_PRICE_INDIE_BASE=${indieBase.id}`,
    `STRIPE_PRICE_INDIE_DIAGNOSES_OVERAGE=${indieDiagnosesOverage.id}`,
    `STRIPE_PRICE_PRO_BASE_V2=${proBaseV2.id}`,
    `STRIPE_PRICE_PRO_DIAGNOSES_OVERAGE=${proDiagnosesOverage.id}`,
    ``,
    `# Phase 3 — annual billing prices (~2 months free)`,
    `STRIPE_PRICE_INDIE_ANNUAL=${indieAnnual.id}`,
    `STRIPE_PRICE_PRO_ANNUAL=${proAnnual.id}`,
    ``,
    `# Legacy prices (still active for existing subscribers)`,
    `STRIPE_PRICE_STARTER_BASE=${starterBase.id}`,
    `STRIPE_PRICE_STARTER_OVERAGE=${starterOverage.id}`,
    `STRIPE_PRICE_PRO_BASE=${proBaseV1.id}`,
    `STRIPE_PRICE_PRO_OVERAGE=${proOverage.id}`,
    ``,
    `# legacy single-price alias (Cloud Starter pre-tier-rollout)`,
    `STRIPE_DEFAULT_PRICE_ID=${starterBase.id}`,
  ]
  for (const line of envLines) console.log(line)
}

main().catch((err) => {
  console.error('\n✗ Bootstrap failed:')
  console.error(err.message ?? err)
  process.exit(1)
})
