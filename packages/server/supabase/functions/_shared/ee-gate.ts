/**
 * FILE: _shared/ee-gate.ts
 * PURPOSE: Hono middleware applying the EE license gate to enterprise routes
 *          (SSO, audit export, retention policy CRUD, compliance exports).
 *
 * IMPORTANT: eval mode is NOT a hard-off — see _shared/ee-license.ts and
 * packages/server/ee/LICENSE §3. This middleware never returns 4xx for a
 * missing key; it annotates the response and logs the banner so operators
 * and the console can surface "unlicensed production use" honestly.
 */

import type { Context, Next } from 'hono'
import { verifyEeLicense, type EeStatus } from './ee-license.ts'

let cached: { status: EeStatus; at: number } | null = null
const CACHE_MS = 5 * 60 * 1000
let bannerLogged = false

/** Resolve (and cache) the deployment's EE license status from env. */
export async function getEeStatus(): Promise<EeStatus> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.status
  const status = await verifyEeLicense(
    Deno.env.get('MUSHI_EE_LICENSE_KEY'),
    // Optional override so a fork can run its own licensing authority.
    Deno.env.get('MUSHI_EE_PUBLIC_KEY') || undefined,
  )
  cached = { status, at: now }
  return status
}

/** Test hook — clears the memoized status. */
export function resetEeStatusCache(): void {
  cached = null
  bannerLogged = false
}

/**
 * Gate an EE route. `feature` names the surface for the log line
 * (e.g. 'sso', 'audit-export', 'retention', 'compliance').
 */
export function requireEeLicense(feature: string) {
  return async function eeGate(c: Context, next: Next) {
    const status = await getEeStatus()
    if (status.mode === 'licensed') {
      c.header('X-Mushi-Ee', 'licensed')
    } else {
      c.header('X-Mushi-Ee', 'eval')
      c.header('X-Mushi-Ee-Reason', status.reason)
      if (!bannerLogged) {
        bannerLogged = true
        console.warn(
          `[ee-license] ${feature}: running in EVAL mode (${status.reason}). ` +
            'Enterprise features are licensed for development, testing, and evaluation only. ' +
            'Production Use requires MUSHI_EE_LICENSE_KEY — see packages/server/ee/LICENSE ' +
            'or contact support@kensaur.us.',
        )
      }
    }
    await next()
  }
}
