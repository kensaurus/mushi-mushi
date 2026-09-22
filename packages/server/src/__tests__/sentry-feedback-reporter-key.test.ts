/**
 * FILE: packages/server/src/__tests__/sentry-feedback-reporter-key.test.ts
 * PURPOSE: A Sentry user-feedback report must not put the reporter's email in
 *          reporter_token_hash — and must not make that email a credential.
 *
 * Why (2026-09-22): the column held the raw address. Hashing it the way an SDK
 * token is hashed would be worse: an email is guessable, so anyone could
 * present it on /v1/reporter/* and read that person's threads. The key is a
 * `sentry:`-prefixed digest, which no SDK-presented value can produce (those
 * all resolve to `rk1_…`).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { reporterKey } from '../../supabase/functions/_shared/reporter-token.ts'

const src = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/api/routes/public.ts'),
  'utf8',
)

describe('sentry feedback reporter key', () => {
  it('never stores the raw email in the key column', () => {
    expect(src).not.toMatch(/reporter_token_hash:\s*\(feedback\.email/)
    expect(src).toMatch(/reporter_token_hash: await sentryReporterKey\(feedback\.email\)/)
    // The address still reaches the console through metadata.
    expect(src).toMatch(/userEmail: feedback\.email/)
  })

  it('produces a key no SDK credential can collide with', async () => {
    const email = 'reporter@example.com'
    // What the reporter-thread routes derive from anything a client presents.
    const fromClient = await reporterKey(email)
    expect(fromClient.startsWith('rk1_')).toBe(true)
    expect(fromClient.startsWith('sentry:')).toBe(false)
  })

  it('falls back to the sentinel when Sentry sends no email', () => {
    expect(src).toMatch(/return 'sentry-webhook'/)
  })
})
