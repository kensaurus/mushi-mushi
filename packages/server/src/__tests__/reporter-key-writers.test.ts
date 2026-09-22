/**
 * FILE: packages/server/src/__tests__/reporter-key-writers.test.ts
 * PURPOSE: Every place that writes a reporter-key column must be one of three
 *          things, and a new one must not appear unreviewed.
 *
 * Why (2026-09-22): the reporter-key work audited the SDK and report paths and
 * declared the column safe. It missed the Sentry user-feedback writer, which
 * was putting the reporter's raw email address in there. The columns hold a
 * credential-derived value, so the set of writers is the thing to pin.
 *
 * The scanner reads write *call sites* (`insert`/`upsert`/`update`/`rpc`) and
 * their argument object, not lines ending in `column:`. A first version matched
 * only `column:` and therefore never saw `insert({ ..., reporter_token })` —
 * ES shorthand, the idiomatic form — so `experiments.ts` sat in the reviewed
 * map without ever being matched: a guarantee that guaranteed nothing.
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
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FUNCTIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/functions')

const COLUMNS = ['reporter_token_hash', 'reporter_token', 'reporter_tokens', 'anon_id'] as const

/** `<file> <column>` → why that writer is safe. */
const REVIEWED = new Map<string, 'keyed' | 'stored' | 'sentinel'>([
  ['api/helpers.ts reporter_token_hash', 'keyed'], // reporterKey(report.reporterToken)
  ['api/routes/events.ts anon_id', 'keyed'], // reporterKeyOrNull(batch.anon_id)
  ['api/routes/sessions.ts reporter_token_hash', 'keyed'], // reporterKeyOrNull(...)
  ['api/routes/public.ts reporter_token_hash', 'keyed'], // sentryReporterKey + auth.tokenHash
  ['api/routes/community.ts reporter_token_hash', 'keyed'], // mushi_link_reporter_token derives it
  ['api/routes/experiments.ts reporter_token', 'keyed'], // reporterKey(parsed.data.reporter_token)
  // rewards.ts is deliberately absent: it keys the value once
  // (reporterKeyOrNull) and hands it to resolveEndUser / awardPointsForEndUser,
  // which are the writers. Its only textual match is a zod field.
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

/** Text between the parentheses of the call starting at `open`. */
function argsAt(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return src.slice(open + 1)
}

/**
 * Columns written by this source: any that appear as a property of a
 * `.insert(`/`.upsert(`/`.update(`/`.rpc(` argument — `col: value`, the
 * shorthand `col,` / `col}`, or the `p_col` RPC parameter — plus dotted
 * assignment (`row.col = …`).
 */
function columnsWritten(src: string): Set<string> {
  const out = new Set<string>()

  // (a) Inline call arguments: catches ES shorthand (`insert({ reporter_token })`)
  //     and RPC parameters (`rpc('fn', { p_reporter_token_hash: x })`).
  for (const m of src.matchAll(/\.(insert|upsert|update|rpc)\s*\(/g)) {
    const args = argsAt(src, m.index! + m[0].length - 1)
    for (const col of COLUMNS) {
      if (new RegExp(`\\b(?:p_)?${col}\\b\\s*[:,})]`).test(args)) out.add(col)
    }
  }

  // (b) Property literals anywhere in the file: most writers build the row as
  //     a variable first and insert it later, so (a) alone never sees them.
  //     Zod schemas declare the same names and are not writes.
  for (const line of src.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
    if (/\bz\./.test(line)) continue
    for (const col of COLUMNS) {
      if (new RegExp(`\\b${col}\\s*:`).test(line)) out.add(col)
      // (c) Dotted assignment: `row.reporter_token_hash = …`.
      if (new RegExp(`\\.${col}\\s*=[^=]`).test(line)) out.add(col)
    }
  }
  return out
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

function scan(): Set<string> {
  const found = new Set<string>()
  for (const file of sourceFiles(FUNCTIONS)) {
    const rel = relative(FUNCTIONS, file).replace(/\\/g, '/')
    // reporter-token.ts defines the keying; it writes nothing.
    if (rel === '_shared/reporter-token.ts') continue
    // No comment stripping: a regex for /* … */ mangles these files (it ate
    // three quarters of sessions.ts), and prose about a column does not sit
    // inside a write call's parentheses anyway. The dotted-assignment scan
    // skips comment lines itself.
    for (const col of columnsWritten(readFileSync(file, 'utf8'))) found.add(`${rel} ${col}`)
  }
  return found
}

describe('reporter-key column writers', () => {
  it('every writer is classified', () => {
    const unreviewed = [...scan()].filter((k) => !REVIEWED.has(k)).sort()
    expect(unreviewed, 'new reporter-key writer — classify it in REVIEWED').toEqual([])
  })

  it('every classification still matches a writer', () => {
    // Without this the map rots: an entry whose call site moved or vanished
    // keeps asserting safety for code that is no longer there, and the
    // scanner can silently stop matching a file (how the shorthand hole hid).
    const found = scan()
    const stale = [...REVIEWED.keys()].filter((k) => !found.has(k)).sort()
    expect(stale, 'REVIEWED entry matches no writer — remove it or fix the scanner').toEqual([])
  })

  it('sees shorthand, dotted assignment and RPC parameters', () => {
    // The three forms the first version of this scanner missed.
    expect(columnsWritten(`db.from('t').insert({ project_id, reporter_token })`)).toContain('reporter_token')
    expect(columnsWritten(`row.reporter_token_hash = value`)).toContain('reporter_token_hash')
    expect(columnsWritten(`db.rpc('fn', { p_reporter_token_hash: body.hash })`)).toContain('reporter_token_hash')
    // A read is not a write.
    expect(columnsWritten(`db.from('t').select('id').eq('reporter_token_hash', key)`).size).toBe(0)
  })
})
