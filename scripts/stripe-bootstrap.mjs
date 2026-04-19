#!/usr/bin/env node
// FILE: scripts/stripe-bootstrap.mjs
// PURPOSE: Idempotently provision the Stripe Billing objects Mushi Mushi Cloud
//          needs — meters, metered overage prices, and (optionally) re-create
//          the flat tier prices if they're missing. Safe to re-run.
//
// What it creates (all live in the Stripe account named in `account` field of
// `get_stripe_account_info`):
//   1. Billing Meters
//      - mushi_reports_ingested  (SUM, payload key: stripe_customer_id)
//      - mushi_fixes_succeeded   (SUM, payload key: stripe_customer_id)
//   2. Metered overage Prices linked to mushi_reports_ingested
//      - mushi:reports:overage:starter:v1   $0.0025 per report
//      - mushi:reports:overage:pro:v1       $0.0020 per report
//   3. Confirms the four base products + Starter/Pro flat prices exist (they
//      were created via the Cursor Stripe MCP in the same scaffolding pass).
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
      'Stripe-Version': '2025-08-27.acacia',
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

  // ------------------- Products -------------------
  heading('2/3  Products')
  const products = {
    starter: await findProductByName('Mushi Mushi — Starter'),
    pro: await findProductByName('Mushi Mushi — Pro'),
    reportsOverage: await findProductByName('Mushi Mushi — Reports overage'),
    successfulFixes: await findProductByName('Mushi Mushi — Successful fixes'),
  }
  for (const [k, v] of Object.entries(products)) {
    if (!v) {
      throw new Error(
        `Missing product "${k}" — re-run the Cursor Stripe MCP product-creation step ` +
          `or create it in the Dashboard with name "Mushi Mushi — ${k[0].toUpperCase()}${k.slice(1)}".`,
      )
    }
    log(`product ok: ${v.name} → ${v.id}`)
  }

  // ------------------- Prices -------------------
  heading('3/3  Prices')

  // Flat tier prices were created by the MCP in the scaffolding pass; this
  // step is here so the script self-heals if they're ever deleted in
  // dashboard cleanup.
  const starterBase = await findOrCreatePrice({
    product: products.starter.id,
    currency: 'usd',
    unit_amount: 1900,
    lookup_key: 'mushi:starter:base:v1',
    nickname: 'Mushi Mushi Starter — base $19/mo',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'licensed' },
    metadata: { project: 'mushi-mushi', tier: 'starter', kind: 'base', version: 'v1' },
  })
  const proBase = await findOrCreatePrice({
    product: products.pro.id,
    currency: 'usd',
    unit_amount: 9900,
    lookup_key: 'mushi:pro:base:v1',
    nickname: 'Mushi Mushi Pro — base $99/mo',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'licensed' },
    metadata: { project: 'mushi-mushi', tier: 'pro', kind: 'base', version: 'v1' },
  })

  // Metered overage prices — pegged to the reports meter. `unit_amount_decimal`
  // because $0.0025 cents = 0.25 cents and Stripe needs sub-cent precision.
  const starterOverage = await findOrCreatePrice({
    product: products.reportsOverage.id,
    currency: 'usd',
    unit_amount_decimal: '0.25',
    billing_scheme: 'per_unit',
    lookup_key: 'mushi:reports:overage:starter:v1',
    nickname: 'Mushi Mushi reports overage — Starter ($0.0025/report)',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'metered', meter: reportsMeter.id },
    metadata: { project: 'mushi-mushi', tier: 'starter', kind: 'overage', version: 'v1' },
  })
  const proOverage = await findOrCreatePrice({
    product: products.reportsOverage.id,
    currency: 'usd',
    unit_amount_decimal: '0.20',
    billing_scheme: 'per_unit',
    lookup_key: 'mushi:reports:overage:pro:v1',
    nickname: 'Mushi Mushi reports overage — Pro ($0.0020/report)',
    tax_behavior: 'exclusive',
    recurring: { interval: 'month', usage_type: 'metered', meter: reportsMeter.id },
    metadata: { project: 'mushi-mushi', tier: 'pro', kind: 'overage', version: 'v1' },
  })

  // ------------------- Output env block -------------------
  heading('✓ Bootstrap complete. Add these to your secret store:')
  const envLines = [
    `# --- Stripe (${MODE} mode) — generated ${new Date().toISOString()} ---`,
    `STRIPE_METER_REPORTS_ID=${reportsMeter.id}`,
    `STRIPE_METER_FIXES_ID=${fixesMeter.id}`,
    `STRIPE_METER_REPORTS_EVENT_NAME=mushi_reports_ingested`,
    `STRIPE_METER_FIXES_EVENT_NAME=mushi_fixes_succeeded`,
    `# legacy aliases — keep until quota.ts is fully migrated`,
    `STRIPE_METER_EVENT_NAME=mushi_reports_ingested`,
    ``,
    `STRIPE_PRICE_STARTER_BASE=${starterBase.id}`,
    `STRIPE_PRICE_STARTER_OVERAGE=${starterOverage.id}`,
    `STRIPE_PRICE_PRO_BASE=${proBase.id}`,
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
