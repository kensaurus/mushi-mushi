/**
 * Contract test: every Edge Function that is intended for *internal*
 * server-to-server calls must gate entry with `requireServiceRoleAuth` from
 * `_shared/auth.ts`.
 *
 * Why this test exists (Wave S, 2026-04-23):
 *   - `usage-aggregator` shipped with zero auth before a public URL; anyone
 *     who guessed the slug could burn Stripe metering.
 *   - `prompt-auto-tune` and `library-modernizer` had hand-rolled checks
 *     that only accepted `SUPABASE_SERVICE_ROLE_KEY`. pg_cron (our actual
 *     caller) can't read that env var — the Supabase CLI refuses to set
 *     secrets starting with `SUPABASE_` — so cron requests were silently
 *     dropped as 401 and the weekly loops never ran.
 *
 * Both failure modes share a root cause: no compile-time enforcement that
 * internal functions use the shared auth helper. This test reads the
 * function source verbatim (no Deno runtime, no live HTTP) and asserts
 * either:
 *   - The source imports `requireServiceRoleAuth` and calls it, OR
 *   - The function is explicitly allow-listed as "user-facing by design".
 *
 * Fail-closed: adding a new function without either an import or an
 * allow-list entry triggers a loud failure in CI. Adding a public endpoint
 * requires a one-line acknowledgement.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const functionsRoot = resolve(
  __dirname,
  '../../supabase/functions',
)

/**
 * Allow-list of functions that are publicly reachable by design and must
 * NOT gate with `requireServiceRoleAuth`. Each entry documents why the
 * function is safe without the shared helper.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  // Main HTTP API — uses `adminOrApiKey` / `apiKeyAuth` / `jwtAuth` per
  // route, which is the correct auth surface for user-facing endpoints.
  api: 'Per-route JWT / API-key auth via _shared/auth middlewares',
  // Webhook receivers — verify provider HMAC/signature in-handler.
  'stripe-webhooks': 'Stripe signature verified in handler',
  'webhooks-github-indexer': 'GitHub HMAC verified in handler',
  'slack-interactions': 'Slack signing secret verified in handler',
  // Intelligence report is called by the admin UI via JWT and by internal
  // callers via service role — handler branches on the caller.
  'intelligence-report': 'Dual JWT/service-role handled in handler',
}

function listFunctionDirs(): string[] {
  return readdirSync(functionsRoot)
    .filter((name) => {
      if (name.startsWith('_')) return false
      const full = join(functionsRoot, name)
      if (!statSync(full).isDirectory()) return false
      const indexTs = join(full, 'index.ts')
      try {
        statSync(indexTs)
        return true
      } catch {
        return false
      }
    })
    .sort()
}

function readIndex(fn: string): string {
  return readFileSync(join(functionsRoot, fn, 'index.ts'), 'utf-8')
}

describe('internal-auth contract', () => {
  const fns = listFunctionDirs()

  it('finds at least a dozen functions (sanity check the scanner)', () => {
    expect(fns.length).toBeGreaterThan(10)
  })

  for (const fn of fns) {
    const isAllowlisted = Object.prototype.hasOwnProperty.call(PUBLIC_BY_DESIGN, fn)

    if (isAllowlisted) {
      it(`${fn} is allow-listed as public by design`, () => {
        // Allow-list is a conscious choice, not a skip; assert the source
        // is still readable so removals fail loud instead of silently
        // disabling the check.
        const source = readIndex(fn)
        expect(source.length).toBeGreaterThan(0)
      })
      continue
    }

    it(`${fn} gates entry with requireServiceRoleAuth`, () => {
      const source = readIndex(fn)

      // Import must exist — this catches copy-paste of a new cron function
      // that forgets the helper entirely.
      expect(
        source,
        `expected ${fn}/index.ts to import requireServiceRoleAuth from ../_shared/auth`,
      ).toMatch(/requireServiceRoleAuth[^\n]*from\s+['"]\.\.\/\_shared\/auth\.ts['"]/)

      // Helper must be *called* before doing work. We look for the usage
      // pattern `requireServiceRoleAuth(` anywhere after the import.
      expect(
        source,
        `expected ${fn}/index.ts to call requireServiceRoleAuth(req) before handler work`,
      ).toMatch(/requireServiceRoleAuth\s*\(/)

      // Hand-rolled `authorized()` that only accepts SUPABASE_SERVICE_ROLE_KEY
      // is banned — it rejects pg_cron callers that must use
      // MUSHI_INTERNAL_CALLER_SECRET.
      expect(
        source,
        `${fn}/index.ts uses a hand-rolled auth check; replace with requireServiceRoleAuth`,
      ).not.toMatch(/function\s+authorized\s*\(\s*req\s*:\s*Request\s*\)\s*:\s*boolean/)
    })
  }
})
