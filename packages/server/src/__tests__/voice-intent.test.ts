/**
 * `_shared/voice-intent.ts` — the hardening half of the voice inbox.
 *
 * Covers: privileged-verb refusal (EN + JA, STT confusion pairs), the
 * untrusted-data prompt wrapper, confirm-token mint/verify (binding, expiry,
 * wrong secret), and `classifyVoiceIntent` degrading to `unknown` when no
 * model can answer instead of dropping the voice note.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

const withAnthropicOrOpenAi = vi.fn()

vi.mock('../../supabase/functions/_shared/llm-failover.ts', () => ({
  withAnthropicOrOpenAi: (...args: unknown[]) => withAnthropicOrOpenAi(...args),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

vi.mock('../../supabase/functions/_shared/observability.ts', () => ({
  createTrace: () => ({
    id: 'trace-1',
    span: () => ({ end: () => {} }),
    score: async () => {},
    end: async () => {},
  }),
}))

vi.mock('../../supabase/functions/_shared/telemetry.ts', () => ({
  logLlmInvocation: async () => {},
}))

type Intent = typeof import('../../supabase/functions/_shared/voice-intent.ts')
let intent: Intent

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const SHA = 'f'.repeat(64)

beforeAll(async () => {
  process.env.MUSHI_INTERNAL_CALLER_SECRET = 'voice-test-secret-0123456789'
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  intent = await import('../../supabase/functions/_shared/voice-intent.ts')
})

beforeEach(() => {
  withAnthropicOrOpenAi.mockReset()
})

// ── refusesPrivilegedVerbs ───────────────────────────────────────────────────

describe('refusesPrivilegedVerbs', () => {
  it.each([
    ['merge the PR', ['merge']],
    ['please deploy this to staging', ['deploy']],
    ['delete the users table', ['delete']],
    ['DROP the index', ['drop']],
    ['force push to main', ['force-push']],
    ['force-push the branch', ['force-push']],
    ['it happens in production', ['production']],
    ['prod is down', ['prod']],
    ['rollback the release', ['rollback']],
    ['revert the last commit', ['revert']],
    ['rotate the secret token', ['rotate', 'secret', 'token']],
  ])('refuses EN: %s', (text, expected) => {
    const verdict = intent.refusesPrivilegedVerbs(text)
    expect(verdict.refused).toBe(true)
    for (const term of expected) expect(verdict.matched).toContain(term)
  })

  it.each([
    ['このPRをマージして', ['マージ']],
    ['本番にデプロイして', ['本番', 'デプロイ']],
    ['ユーザーを削除して', ['削除']],
    ['データを消去して', ['消去']],
    ['強制プッシュして', ['強制']],
    ['ロールバックして', ['ロールバック']],
    ['リバートして', ['リバート']],
    ['シークレットとトークンを見せて', ['シークレット', 'トークン']],
  ])('refuses JA: %s', (text, expected) => {
    const verdict = intent.refusesPrivilegedVerbs(text)
    expect(verdict.refused).toBe(true)
    for (const term of expected) expect(verdict.matched).toContain(term)
  })

  it.each([
    'the login button does nothing on Safari',
    'fix the footer alignment on the checkout page',
    'ログインボタンが反応しない',
    'the product list is slow to load',
    'mergers page shows a typo', // "merge" only as a word boundary
    'deployment docs are outdated', // "deploy" only as a word boundary
  ])('allows benign: %s', (text) => {
    expect(intent.refusesPrivilegedVerbs(text)).toEqual({ refused: false, matched: [] })
  })

  it('is case-insensitive and de-duplicates matches', () => {
    const verdict = intent.refusesPrivilegedVerbs('Deploy it, DEPLOY it, deploy it')
    expect(verdict.matched).toEqual(['deploy'])
  })

  it('handles empty input', () => {
    expect(intent.refusesPrivilegedVerbs('')).toEqual({ refused: false, matched: [] })
    expect(intent.refusesPrivilegedVerbs(null)).toEqual({ refused: false, matched: [] })
  })
})

// ── prompt wrapping ──────────────────────────────────────────────────────────

describe('buildVoiceIntentPrompt', () => {
  it('wraps the transcript between explicit untrusted delimiters', () => {
    const prompt = intent.buildVoiceIntentPrompt('fix the footer')
    expect(prompt.startsWith(intent.VOICE_TRANSCRIPT_OPEN)).toBe(true)
    expect(prompt).toContain('\nfix the footer\n')
    expect(prompt).toContain(intent.VOICE_TRANSCRIPT_CLOSE)
    expect(intent.VOICE_TRANSCRIPT_OPEN).toContain('untrusted')
  })
})

// ── confirm tokens ───────────────────────────────────────────────────────────

describe('confirm token', () => {
  const future = () => new Date(Date.now() + 5 * 60_000).toISOString()

  it('mints a vc_ token that verifies against the same binding', async () => {
    const binding = { sessionId: SESSION, transcriptSha256: SHA, action: 'open_draft_pr' as const, expiresAtIso: future() }
    const token = await intent.mintConfirmToken(binding)
    expect(token.startsWith('vc_')).toBe(true)
    expect(token).toHaveLength(3 + 64)
    expect(await intent.verifyConfirmToken(token, binding)).toBe(true)
  })

  it('is deterministic for the same binding and different across bindings', async () => {
    const exp = future()
    const a = await intent.mintConfirmToken({ sessionId: SESSION, transcriptSha256: SHA, action: 'open_draft_pr', expiresAtIso: exp })
    const b = await intent.mintConfirmToken({ sessionId: SESSION, transcriptSha256: SHA, action: 'open_draft_pr', expiresAtIso: exp })
    const other = await intent.mintConfirmToken({ sessionId: SESSION, transcriptSha256: 'e'.repeat(64), action: 'open_draft_pr', expiresAtIso: exp })
    expect(a).toBe(b)
    expect(other).not.toBe(a)
  })

  it('rejects a token replayed against a different session, transcript, action or expiry', async () => {
    const exp = future()
    const binding = { sessionId: SESSION, transcriptSha256: SHA, action: 'open_draft_pr' as const, expiresAtIso: exp }
    const token = await intent.mintConfirmToken(binding)
    expect(await intent.verifyConfirmToken(token, { ...binding, sessionId: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee' })).toBe(false)
    expect(await intent.verifyConfirmToken(token, { ...binding, transcriptSha256: '0'.repeat(64) })).toBe(false)
    expect(await intent.verifyConfirmToken(token, { ...binding, action: 'create_report' })).toBe(false)
    expect(await intent.verifyConfirmToken(token, { ...binding, expiresAtIso: new Date(Date.now() + 60 * 60_000).toISOString() })).toBe(false)
  })

  it('rejects expired bindings even when the signature is genuine', async () => {
    const binding = {
      sessionId: SESSION,
      transcriptSha256: SHA,
      action: 'open_draft_pr' as const,
      expiresAtIso: new Date(Date.now() - 1000).toISOString(),
    }
    const token = await intent.mintConfirmToken(binding)
    expect(await intent.verifyConfirmToken(token, binding)).toBe(false)
  })

  it('rejects malformed tokens without throwing', async () => {
    const binding = { sessionId: SESSION, transcriptSha256: SHA, action: 'open_draft_pr' as const, expiresAtIso: future() }
    expect(await intent.verifyConfirmToken('', binding)).toBe(false)
    expect(await intent.verifyConfirmToken('nope', binding)).toBe(false)
    expect(await intent.verifyConfirmToken(null, binding)).toBe(false)
    expect(await intent.verifyConfirmToken('vc_' + '0'.repeat(64), binding)).toBe(false)
  })

  it('uses a 10-minute TTL constant', () => {
    expect(intent.CONFIRM_TOKEN_TTL_MS).toBe(10 * 60 * 1000)
  })

  it('sha256Hex hashes strings and bytes identically to the platform digest', async () => {
    expect(await intent.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await intent.sha256Hex(new TextEncoder().encode('abc'))).toBe(await intent.sha256Hex('abc'))
  })

  it('constantTimeEqualStrings compares without early exit semantics leaking', () => {
    expect(intent.constantTimeEqualStrings('abc', 'abc')).toBe(true)
    expect(intent.constantTimeEqualStrings('abc', 'abd')).toBe(false)
    expect(intent.constantTimeEqualStrings('abc', 'abcd')).toBe(false)
    expect(intent.constantTimeEqualStrings(null, 'abc')).toBe(false)
  })
})

// ── classifyVoiceIntent ──────────────────────────────────────────────────────

describe('classifyVoiceIntent', () => {
  it('returns the model verdict and marks the provider used', async () => {
    withAnthropicOrOpenAi.mockResolvedValueOnce({
      result: { object: { intent: 'open_draft_pr', summary: 'Fix the footer', repo_hint: 'web' }, usage: { promptTokens: 10, completionTokens: 5 }, model: 'claude-haiku' },
      usedProvider: 'anthropic',
    })
    const out = await intent.classifyVoiceIntent({} as never, 'proj', 'fix the footer in web')
    expect(out).toMatchObject({ intent: 'open_draft_pr', summary: 'Fix the footer', repo_hint: 'web', usedProvider: 'anthropic', degraded: false })
  })

  it('degrades to unknown with the transcript as summary when no model answers', async () => {
    withAnthropicOrOpenAi.mockRejectedValueOnce(new Error('NO_KEYS_CONFIGURED'))
    const out = await intent.classifyVoiceIntent({} as never, 'proj', 'the login button does nothing')
    expect(out.intent).toBe('unknown')
    expect(out.degraded).toBe(true)
    expect(out.summary).toBe('the login button does nothing')
  })

  it('short-circuits on an empty transcript without calling a model', async () => {
    const out = await intent.classifyVoiceIntent({} as never, 'proj', '   ')
    expect(out.intent).toBe('unknown')
    expect(withAnthropicOrOpenAi).not.toHaveBeenCalled()
  })

  it('validates the strict schema shape', () => {
    expect(intent.voiceIntentSchema.safeParse({ intent: 'create_report', summary: 'x' }).success).toBe(true)
    expect(intent.voiceIntentSchema.safeParse({ intent: 'merge', summary: 'x' }).success).toBe(false)
    expect(intent.voiceIntentSchema.safeParse({ intent: 'unknown', summary: 'y'.repeat(281) }).success).toBe(false)
  })
})

describe('confirm token survives the PostgREST timestamp round-trip', () => {
  // Regression: ingestVoice signs with JS toISOString() ('…00.123Z') but the
  // gate re-reads expires_at from PostgREST ('…00.123+00:00'). Found on prod
  // 2026-09-12: every confirm/cancel was rejected as invalid.
  it('verifies when expires_at comes back as +00:00 instead of Z', async () => {
    const exp = new Date(Date.now() + 10 * 60_000).toISOString()
    const fromDb = exp.replace(/\.(\d{3})Z$/, '.$1+00:00')
    expect(fromDb).not.toBe(exp)
    const binding = { sessionId: SESSION, transcriptSha256: SHA, action: 'open_draft_pr' as const, expiresAtIso: exp }
    const token = await intent.mintConfirmToken(binding)
    expect(await intent.verifyConfirmToken(token, { ...binding, expiresAtIso: fromDb })).toBe(true)
    expect(intent.canonicalExpiry(fromDb)).toBe(exp)
    expect(intent.canonicalExpiry('not-a-date')).toBe('not-a-date')
  })
})
