/**
 * FILE: packages/server/src/__tests__/reporter-key-writers.test.ts
 * PURPOSE: Every place that writes a reporter-key column must be one of three
 *          things, and a new one must not appear unreviewed.
 *
 * Why (2026-09-22): the reporter-key work audited the SDK and report paths and
 * declared the column safe. It missed the Sentry user-feedback writer, which
 * was putting the reporter's raw email address in there — found only after the
 * fact. The columns hold a credential-derived value, so the set of writers is
 * the thing to pin, not any single writer.
 *
 * A writer is legitimate when it is:
 *   keyed    — passes client input through reporterKey()/sentryReporterKey()
 *              exactly once, or hands it to an RPC that derives the key,
 *   stored   — copies a value already read back from the database,
 *   sentinel — writes a named non-credential marker ('cron:<job>', etc).
 *
 * Adding a writer? Classify it here. If it takes something a client sent and
 * is not `keyed`, it is a bug — that is exactly what the email was.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FUNCTIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/functions')

/** file:line → why this writer is safe. */
const REVIEWED = new Map<string, 'keyed' | 'stored' | 'sentinel'>([
  ['api/helpers.ts reporter_token_hash', 'keyed'], // reporterKey(report.reporterToken)
  ['api/routes/events.ts anon_id', 'keyed'], // reporterKeyOrNull(batch.anon_id)
  ['api/routes/sessions.ts reporter_token_hash', 'keyed'], // reporterKeyOrNull(...)
  ['api/routes/public.ts reporter_token_hash', 'keyed'], // sentryReporterKey + auth.tokenHash
  ['api/routes/community.ts reporter_token_hash', 'keyed'], // mushi_link_reporter_token derives it
  ['api/routes/experiments.ts reporter_token', 'keyed'], // reporterKey(parsed.data.reporter_token)
  ['api/routes/rewards.ts reporter_token_hash', 'keyed'], // reporterKeyOrNull once, reused
  ['api/routes/tester-marketplace.ts reporter_token_hash', 'keyed'], // reporterKey(`roadmap:${visitor}`)
  ['api/routes/reporter-feature-board.ts reporter_token_hash', 'stored'], // auth.tokenHash
  ['_shared/notifications.ts reporter_token_hash', 'stored'], // callers pass a row value
  ['_shared/reputation.ts reporter_token_hash', 'stored'], // caller passes the key
  ['_shared/telemetry.ts reporter_token_hash', 'stored'], // caller passes the key
  ['_shared/anti-gaming.ts reporter_tokens', 'stored'], // caller passes the key, or 'tester:<id>'
  ['_shared/product-events.ts anon_id', 'stored'], // payload.anonId; no caller passes a raw id
  ['_shared/sentry-ingest.ts reporter_token_hash', 'sentinel'], // 'sentry-webhook'
  ['_shared/voice-intake.ts reporter_token_hash', 'sentinel'], // 'voice-intake'
  ['library-modernizer/index.ts reporter_token_hash', 'sentinel'], // 'cron:library-modernizer'
  ['status-reconciler/index.ts reporter_token_hash', 'sentinel'], // 'cron:status-reconciler'
  ['webhooks-linear-agent/index.ts reporter_token_hash', 'sentinel'], // 'linear-agent'
])

const COLUMN = /\b(reporter_token_hash|reporter_token|reporter_tokens|anon_id)\s*:/

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('reporter-key column writers', () => {
  it('every writer is classified', () => {
    const found = new Set<string>()
    for (const file of sourceFiles(FUNCTIONS)) {
      const rel = relative(FUNCTIONS, file).replace(/\\/g, '/')
      // reporter-token.ts defines the keying; it writes nothing.
      if (rel === '_shared/reporter-token.ts') continue
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const trimmed = line.trim()
        // Comments, zod schemas and RPC parameter names are not writes.
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
        const m = line.match(COLUMN)
        if (!m || /z\./.test(line) || /p_reporter_token_hash/.test(line)) continue
        found.add(`${rel} ${m[1]}`)
      }
    }
    const unreviewed = [...found].filter((k) => !REVIEWED.has(k)).sort()
    expect(unreviewed, 'new reporter-key writer — classify it in REVIEWED').toEqual([])
  })

  it('the client-facing writers key their input exactly once', () => {
    const publicTs = readFileSync(join(FUNCTIONS, 'api/routes/public.ts'), 'utf8')
    // The Sentry feedback writer is the one this test exists for.
    expect(publicTs).toMatch(/reporter_token_hash: await sentryReporterKey\(/)
    expect(publicTs).not.toMatch(/reporter_token_hash:\s*\(feedback\.email/)
  })
})
