#!/usr/bin/env node
/**
 * FILE: scripts/verify-auth-providers.mjs
 * PURPOSE: Fail fast when GoTrue does not expose the OAuth providers the
 *          admin login page expects. Prevents shipping a console where
 *          "Continue with Google" dumps users on a raw JSON 400 page.
 *
 * Usage:
 *   node scripts/verify-auth-providers.mjs
 *   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… node scripts/verify-auth-providers.mjs
 *   MUSHI_REQUIRED_AUTH_PROVIDERS=google,github node scripts/verify-auth-providers.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Read the public cloud anon fallback from apps/admin/src/lib/env.ts (single source of truth). */
function readCloudAnonFallback() {
  try {
    const src = readFileSync(join(ROOT, 'apps/admin/src/lib/env.ts'), 'utf8')
    const match = src.match(/HARDCODED_CLOUD_ANON_KEY_FALLBACK = '([^']+)'/)
    return match?.[1] ?? ''
  } catch {
    return ''
  }
}

const SUPABASE_URL = (
  process.env.VITE_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  'https://dxptnwrhwsqckaftyymj.supabase.co'
).replace(/\/$/, '')

const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.VITE_CLOUD_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  readCloudAnonFallback()

const REQUIRED = (process.env.MUSHI_REQUIRED_AUTH_PROVIDERS ?? 'google,github')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

async function main() {
  if (!ANON_KEY) {
    console.error(
      'FAIL verify-auth-providers: set VITE_SUPABASE_ANON_KEY (or VITE_CLOUD_SUPABASE_ANON_KEY)',
    )
    process.exit(1)
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: ANON_KEY },
  })

  if (!res.ok) {
    console.error(`FAIL verify-auth-providers: GET /auth/v1/settings returned HTTP ${res.status}`)
    process.exit(1)
  }

  const settings = await res.json()
  const external = settings?.external ?? {}
  const missing = REQUIRED.filter((provider) => external[provider] !== true)

  if (missing.length) {
    console.error('FAIL verify-auth-providers: required OAuth providers disabled on GoTrue:')
    for (const provider of missing) {
      console.error(`  - ${provider}: ${external[provider] === true ? 'enabled' : 'disabled/missing'}`)
    }
    console.error('')
    console.error('Enable them in Supabase Auth → Providers (or Management API) before deploy.')
    process.exit(1)
  }

  console.log(
    `OK verify-auth-providers @ ${SUPABASE_URL} (${REQUIRED.join(', ')} enabled)`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
