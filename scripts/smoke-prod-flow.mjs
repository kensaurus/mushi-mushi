#!/usr/bin/env node
// =============================================================================
// scripts/smoke-prod-flow.mjs
//
// End-to-end smoke for the production cutover (Phase 5 of the
// production-readiness 12/10 PDCA pass). Run this after every deploy
// — it exits non-zero on the first failure and prints a single-line
// summary so it can wrap a `pre-merge` gate.
//
// What it asserts
// ---------------
//   1. https://kensaur.us/mushi-mushi/        → 200 + body markers (washi
//      cream landing or admin shell, depending on whether Phase 4 has
//      run yet — the assertion auto-detects).
//   2. https://kensaur.us/mushi-mushi/admin/  → 200 + admin SPA shell.
//   3. https://kensaur.us/mushi-mushi/docs/   → 200 + Nextra markers
//      (only enforced when the docs deploy has run; tolerated 404 first time).
//   4. POST /v1/admin/sso/configure with a Hobby JWT → 402 +
//      `code: 'feature_not_in_plan'` (Phase 1 server-side gate).
//      Skipped when MUSHI_HOBBY_JWT is unset; gate-test the matrix in
//      `packages/server/src/__tests__/entitlements.test.ts` instead.
//   5. /v1/api/health → 200 + `{ status: 'ok' }` (gateway sanity).
//   6. /v1/admin/entitlements with MUSHI_HOBBY_JWT → 200 + planId='hobby'
//      and `featureFlags.sso === false` (introspection consistency).
//
// Required env
// ------------
//   (none for items 1-3 + 5; smoke against the live URL is anonymous.)
//
// Optional env
// ------------
//   MUSHI_HOBBY_JWT      — Supabase user JWT for a hobby-tier account.
//                          When unset, the entitlement assertions are
//                          marked SKIPPED (printed in yellow); items 1-3
//                          + 5 still run.
//   MUSHI_API_BASE       — defaults to the Supabase project base.
//   MUSHI_SITE_BASE      — defaults to https://kensaur.us/mushi-mushi.
//
// Exit codes
// ----------
//   0 — every required check passed.
//   1 — at least one required check failed.
//
// Why this script exists
// ----------------------
// `scripts/smoke-admin-endpoints.mjs` is the per-route gate for the
// admin gateway (200 vs 5xx). This script is the *flow* gate — it
// proves the unified `/mushi-mushi/*` topology resolves, the gateway
// is reachable from the public internet, and the entitlement gating
// (Phase 1) actually rejects unentitled callers in production. Run
// both in CI; they answer different questions.
// =============================================================================

const SITE = (process.env.MUSHI_SITE_BASE ?? 'https://kensaur.us/mushi-mushi').replace(/\/$/, '')
const API = (process.env.MUSHI_API_BASE ?? 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api').replace(/\/$/, '')
const HOBBY_JWT = process.env.MUSHI_HOBBY_JWT ?? null

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

let failures = 0
let skipped = 0

function pass(name, info = '') {
  console.log(`${GREEN}✓${RESET} ${name}${info ? `  ${DIM}${info}${RESET}` : ''}`)
}
function fail(name, info) {
  failures++
  console.error(`${RED}✗ ${name}${RESET}  ${info}`)
}
function skip(name, reason) {
  skipped++
  console.log(`${YELLOW}○ ${name}${RESET}  ${DIM}skipped: ${reason}${RESET}`)
}

async function check(name, fn) {
  try {
    await fn()
  } catch (err) {
    fail(name, err.message ?? String(err))
  }
}

async function getText(url, init = {}) {
  const res = await fetch(url, init)
  const text = await res.text()
  return { status: res.status, text, headers: res.headers }
}

// --- 1. Cloud landing -------------------------------------------------------
await check('cloud landing returns 200', async () => {
  const { status, text } = await getText(`${SITE}/`)
  if (status !== 200) throw new Error(`expected 200, got ${status}`)
  // Either the new editorial cloud landing (post Phase 4) or the legacy
  // admin shell (pre Phase 4). Both must be served, neither may be a
  // CloudFront error page.
  const isEditorial = /むしむし|mushi-mushi/i.test(text) && /washi|paper|sumi|vermillion|editorial/i.test(text)
  const isLegacyAdmin = /<div id="root">/i.test(text) || /<div id="app">/i.test(text)
  if (!isEditorial && !isLegacyAdmin) {
    throw new Error('body did not match editorial-cloud OR legacy-admin markers')
  }
  pass('cloud landing returns 200', isEditorial ? 'editorial cloud (Phase 4 done)' : 'legacy admin shell (Phase 4 pending)')
})

// --- 2. Admin SPA -----------------------------------------------------------
await check('admin SPA renders shell', async () => {
  const { status, text } = await getText(`${SITE}/admin/`)
  if (status !== 200) throw new Error(`expected 200, got ${status}`)
  if (!/<div id="root">/i.test(text) && !/<div id="app">/i.test(text)) {
    throw new Error('admin SPA root element not found in body')
  }
  pass('admin SPA renders shell')
})

// --- 3. Docs site -----------------------------------------------------------
await check('docs site reachable', async () => {
  const { status, text } = await getText(`${SITE}/docs/`)
  // First-time deploy returns 404 until deploy-docs has run; tolerate.
  if (status === 404) {
    skip('docs site reachable', `404 — deploy-docs.yml has not run yet`)
    return
  }
  if (status !== 200) throw new Error(`expected 200, got ${status}`)
  // Pre Phase 4: CloudFront's SPA router falls through to the admin
  // index.html, so this endpoint can legitimately return the admin
  // shell. Post-docs-deploy, Nextra serves its own markup. Accept
  // either; flag the pre-deploy case so it's visible.
  const isNextra = /Nextra|next-route-announcer|__next/i.test(text)
  const isAdminFallthrough = /<div id="root">/i.test(text) || /<div id="app">/i.test(text)
  if (!isNextra && !isAdminFallthrough) {
    throw new Error('docs body did not match Nextra OR admin-fallthrough markers')
  }
  pass('docs site reachable', isNextra ? 'Nextra' : 'admin fallthrough (deploy-docs.yml has not run yet)')
})

// --- 5. Gateway /health -----------------------------------------------------
// (numbered out of order intentionally; matches the order users care about.)
await check('gateway /health responds 200 ok', async () => {
  const { status, text } = await getText(`${API}/health`)
  if (status !== 200) throw new Error(`expected 200, got ${status} — body=${text.slice(0, 120)}`)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('health body was not valid JSON')
  }
  if (body?.status !== 'ok') {
    throw new Error(`status field was ${JSON.stringify(body?.status)}, expected "ok"`)
  }
  pass('gateway /health responds 200 ok', body?.region ? `region=${body.region}` : '')
})

// --- 4 + 6. Entitlement gating (requires HOBBY JWT) -------------------------
if (!HOBBY_JWT) {
  skip('entitlements introspection (hobby)', 'MUSHI_HOBBY_JWT not set')
  skip('SSO write blocked for hobby (402)', 'MUSHI_HOBBY_JWT not set')
} else {
  await check('entitlements introspection (hobby)', async () => {
    const { status, text } = await getText(`${API}/v1/admin/entitlements`, {
      headers: { Authorization: `Bearer ${HOBBY_JWT}` },
    })
    if (status !== 200) throw new Error(`expected 200, got ${status}`)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error('entitlements body was not valid JSON')
    }
    const planId = body?.data?.planId
    const ssoFlag = body?.data?.featureFlags?.sso
    if (planId !== 'hobby') {
      throw new Error(`expected planId=hobby, got ${JSON.stringify(planId)} — make sure the JWT is for a hobby-tier user`)
    }
    if (ssoFlag === true) {
      throw new Error(`feature_flags.sso must be false on hobby; got ${JSON.stringify(ssoFlag)}`)
    }
    pass('entitlements introspection (hobby)', `planId=${planId} sso=${JSON.stringify(ssoFlag)}`)
  })

  await check('SSO write blocked for hobby (402)', async () => {
    const { status, text } = await getText(`${API}/v1/admin/sso/configure`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HOBBY_JWT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entity_id: 'smoke-test', sso_url: 'https://example.com/sso' }),
    })
    if (status !== 402) {
      throw new Error(`expected 402, got ${status} — Phase 1 entitlement gate is NOT enforcing for SSO writes`)
    }
    let body
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error('402 body was not valid JSON')
    }
    if (body?.error?.code !== 'feature_not_in_plan') {
      throw new Error(`expected error.code=feature_not_in_plan, got ${JSON.stringify(body?.error?.code)}`)
    }
    pass('SSO write blocked for hobby (402)', `code=${body.error.code}`)
  })
}

// --- Summary ----------------------------------------------------------------
console.log('')
if (failures > 0) {
  console.error(`${RED}${failures} check(s) failed${RESET}${skipped ? ` (${skipped} skipped)` : ''}`)
  process.exit(1)
}
console.log(`${GREEN}all required checks passed${RESET}${skipped ? ` ${DIM}(${skipped} skipped)${RESET}` : ''}`)
process.exit(0)
