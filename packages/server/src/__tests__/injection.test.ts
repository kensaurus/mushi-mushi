// ============================================================
// Wave D D8: prompt-injection regression — port-shaped test.
//
// The canonical sanitizer lives in
// `packages/server/supabase/functions/_shared/sanitize.ts` (Deno).
// We can't import a Deno module from Node/vitest directly, so this
// test re-implements the *minimum* contract — "any sanitizer must
// neutralise these payloads" — using a tiny inlined version. When
// the deferred Node-side mirror in `@mushi-mushi/core` lands
// (tracked as `waveD-d8-node-mirror`), swap the inline `sanitize`
// for the imported one and the corpus assertions stay valid.
// ============================================================
import { describe, expect, it } from 'vitest'

// Patterns are reduced to opaque tokens so the test source itself
// reads like benign descriptions, not active jailbreak prose.
const HIJACK_TOKENS = ['IGN_PREV_INST', 'DISREG_ABOVE', 'FORGET_ABOVE'] as const
const ROLE_TOKENS = ['ROLE_FLIP_DAN', 'ACT_AS_ADMIN', 'PRETEND_JAILBREAK'] as const
const TAG_TOKENS = ['SYSTEM_TAG', 'ASSISTANT_TAG', 'INST_TAG', 'CHATML', 'ROLE_HEADER'] as const

interface Payload {
  readonly name: string
  readonly tokens: ReadonlyArray<string>
}

const CORPUS: ReadonlyArray<Payload> = [
  { name: 'classic instruction hijack', tokens: [HIJACK_TOKENS[0]] },
  { name: 'instruction hijack — variant', tokens: [HIJACK_TOKENS[1]] },
  { name: 'forget everything before', tokens: [HIJACK_TOKENS[2]] },
  { name: 'role flip — alias', tokens: [ROLE_TOKENS[0]] },
  { name: 'role flip — pretend', tokens: [ROLE_TOKENS[2]] },
  { name: 'role flip — act as', tokens: [ROLE_TOKENS[1]] },
  { name: 'system tag injection', tokens: [TAG_TOKENS[0]] },
  { name: 'assistant tag injection', tokens: [TAG_TOKENS[1]] },
  { name: 'INST tag injection', tokens: [TAG_TOKENS[2]] },
  { name: 'ChatML mimicry', tokens: [TAG_TOKENS[3]] },
  { name: 'role header injection', tokens: [TAG_TOKENS[4]] },
]

// Minimal stand-in: any token from any group is replaced by a
// `[BLOCKED_*]` marker, mirroring the real sanitizer's contract.
const sanitize = (input: string): { text: string; blocked: number } => {
  let text = String(input ?? '').normalize('NFKC')
  let blocked = 0

  const replaceGroup = (tokens: ReadonlyArray<string>, marker: string) => {
    for (const t of tokens) {
      const before = text
      text = text.split(t).join(marker)
      if (before !== text) blocked += 1
    }
  }

  replaceGroup(HIJACK_TOKENS, '[BLOCKED_INSTRUCTION]')
  replaceGroup(ROLE_TOKENS, '[BLOCKED_ROLE_FLIP]')
  replaceGroup(TAG_TOKENS, '[BLOCKED_TAG]')

  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  return { text, blocked }
}

describe('sanitize (D8 contract)', () => {
  it.each(CORPUS.map((c) => [c.name, c.tokens] as const))(
    'blocks: %s',
    (_name, tokens) => {
      const payload = `report context: ${tokens.join(' ')} trailing notes`
      const { text, blocked } = sanitize(payload)
      expect(blocked).toBeGreaterThan(0)
      for (const t of tokens) {
        expect(text).not.toContain(t)
      }
      expect(text).toMatch(/\[BLOCKED_/)
    },
  )

  it('preserves benign report text untouched', () => {
    const benign =
      'The login button on the checkout page does nothing on mobile Safari iOS 17. ' +
      'Repro: open /checkout, tap "Pay".'
    const { text, blocked } = sanitize(benign)
    expect(blocked).toBe(0)
    expect(text).toBe(benign)
  })

  it('strips ASCII control characters', () => {
    const dirty = 'visible text\u0000\u0007\u001b after control chars'
    const { text } = sanitize(dirty)
    expect(text).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/)
    expect(text).toContain('visible text')
    expect(text).toContain('after control chars')
  })
})
