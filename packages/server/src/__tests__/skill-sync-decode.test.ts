/**
 * skill-sync decodes GitHub's base64 blob content. Plain `atob` returns one
 * char per byte, so multi-byte UTF-8 ("—", "→", "…") was stored as mojibake.
 */
import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>).Deno = {
    serve: () => undefined,
    env: { get: () => undefined },
  }
})

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (h: unknown) => h }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/embeddings.ts', () => ({ createEmbedding: async () => null }))
vi.mock('../../supabase/functions/_shared/secret-scan.ts', () => ({ scanForSecrets: () => [] }))

import { decodeBase64Utf8 } from '../../supabase/functions/skill-sync/index.ts'

/** Mirror GitHub: base64 of the UTF-8 bytes, wrapped at 60 chars with \n. */
function githubBase64(text: string): string {
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  return b64.match(/.{1,60}/g)!.join('\n')
}

describe('decodeBase64Utf8', () => {
  it('round-trips multi-byte UTF-8 without mojibake', () => {
    const text = '---\nname: workflow-spec-tdd\ndescription: spec — TDD → ship… 日本語\n---\nbody'
    const out = decodeBase64Utf8(githubBase64(text))
    expect(out).toBe(text)
    expect(out).not.toContain('â')
  })

  it('keeps plain ASCII unchanged', () => {
    expect(decodeBase64Utf8(githubBase64('name: plain'))).toBe('name: plain')
  })

  it('ignores the newlines GitHub inserts into long payloads', () => {
    const text = 'x'.repeat(200) + ' — end'
    expect(decodeBase64Utf8(githubBase64(text))).toBe(text)
  })
})
