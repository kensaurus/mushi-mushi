/**
 * The console copy of the BYOK key rules must match the server copy
 * (`packages/server/supabase/functions/_shared/byok-key-rules.ts`) byte for
 * byte below the BODY marker, so the Add-key form and the API give the same
 * answer in the same words. Every key here is an obvious fake.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareByokSecret } from './byokKeyRules'

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const MARKER = '// ---- BODY: keep identical with apps/admin/src/lib/byokKeyRules.ts ----'

function body(rel: string): string {
  const src = readFileSync(resolve(REPO_ROOT, rel), 'utf8')
  const at = src.indexOf(MARKER)
  expect(at, `${rel} has the BODY marker`).toBeGreaterThan(-1)
  return src.slice(at)
}

describe('byokKeyRules parity', () => {
  it('matches the server rule table and normalizer exactly', () => {
    expect(body('apps/admin/src/lib/byokKeyRules.ts')).toBe(
      body('packages/server/supabase/functions/_shared/byok-key-rules.ts'),
    )
  })
})

describe('prepareByokSecret (console)', () => {
  it('cleans common pastes and says what it removed', () => {
    expect(prepareByokSecret('openai', 'OPENAI_API_KEY=sk-proj-FAKE0001\n')).toEqual({
      ok: true,
      value: 'sk-proj-FAKE0001',
      removed: ['OPENAI_API_KEY='],
    })
    expect(prepareByokSecret('anthropic', 'export X="sk-ant-FAKE0002"')).toEqual({
      ok: true,
      value: 'sk-ant-FAKE0002',
      removed: ['export X=', 'the quotes around it'],
    })
  })

  it('rejects a key with a space in the middle', () => {
    expect(prepareByokSecret('openai', 'sk-proj FAKE0003').ok).toBe(false)
  })

  it('names the right row for a key from another provider', () => {
    expect(prepareByokSecret('openai', 'sk-ant-FAKE0004')).toEqual({
      ok: false,
      message: 'This looks like an Anthropic key — paste it in the Anthropic row.',
    })
    expect(prepareByokSecret('anthropic', 'fc-FAKE00000005')).toEqual({
      ok: false,
      message: 'This looks like a Firecrawl key — paste it in the Firecrawl row.',
    })
  })

  it('explains the wrong kind of Supabase credential', () => {
    const result = prepareByokSecret('supabase', 'sb_secret_FAKE0006')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/project secret key, not an access token/)
  })
})
