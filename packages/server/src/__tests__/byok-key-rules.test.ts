/**
 * FILE: byok-key-rules.test.ts
 * PURPOSE: The BYOK paste normalizer and per-provider prefix rules
 *          (`_shared/byok-key-rules.ts`, input-validation plan I2/I3), and
 *          parity with the console mirror `apps/admin/src/lib/byokKeyRules.ts`:
 *          the body text must be identical and both copies must give the
 *          same answer for every case, so the form and the server say the
 *          same sentence. Every key here is an obvious fake.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareByokSecret } from '../../supabase/functions/_shared/byok-key-rules.ts'
import { prepareByokSecret as adminPrepareByokSecret } from '../../../../apps/admin/src/lib/byokKeyRules.ts'

const ROOT = resolve(__dirname, '../../../..')
const MARKER = '// ---- BODY: keep identical with apps/admin/src/lib/byokKeyRules.ts ----'

function body(rel: string): string {
  const src = readFileSync(resolve(ROOT, rel), 'utf8')
  const at = src.indexOf(MARKER)
  expect(at, `${rel} has the BODY marker`).toBeGreaterThan(-1)
  return src.slice(at)
}

describe('normalizeSecretPaste (through prepareByokSecret)', () => {
  it.each([
    ['OPENAI_API_KEY=sk-proj-FAKE0001', 'openai', 'sk-proj-FAKE0001', ['OPENAI_API_KEY=']],
    ['export X="sk-ant-FAKE0002"', 'anthropic', 'sk-ant-FAKE0002', ['export X=', 'the quotes around it']],
    ["'fc-FAKE0003'", 'firecrawl', 'fc-FAKE0003', ['the quotes around it']],
    ['`fc-FAKE0004`', 'firecrawl', 'fc-FAKE0004', ['the quotes around it']],
    ['sk-proj-FAKE0005\n', 'openai', 'sk-proj-FAKE0005', []],
    ['  \r\nsbp_FAKE0006\r\n ', 'supabase', 'sbp_FAKE0006', []],
    ['FIRECRAWL_API_KEY = "fc-FAKE0007"', 'firecrawl', 'fc-FAKE0007', ['FIRECRAWL_API_KEY=', 'the quotes around it']],
  ])('%j in %s → %s', (raw, provider, value, removed) => {
    expect(prepareByokSecret(provider, raw)).toEqual({ ok: true, value, removed })
  })

  it('rejects internal whitespace instead of guessing', () => {
    expect(prepareByokSecret('openai', 'sk-proj-FAKE 0008')).toEqual({
      ok: false,
      message: "The key has a space or line break in the middle. Copy it again from the provider's dashboard.",
    })
    expect(prepareByokSecret('openai', 'sk-proj-FAKE\n0009').ok).toBe(false)
  })

  it('rejects empty, too short and absurdly long values', () => {
    expect(prepareByokSecret('openai', '   ')).toEqual({ ok: false, message: 'Paste the API key.' })
    expect(prepareByokSecret('openai', 'OPENAI_API_KEY=""').ok).toBe(false)
    expect(prepareByokSecret('openai', 'sk-1')).toMatchObject({ ok: false, message: expect.stringMatching(/too short/) })
    expect(prepareByokSecret('openai', `sk-${'a'.repeat(5000)}`).ok).toBe(false)
    expect(prepareByokSecret('openai', undefined).ok).toBe(false)
  })

  it('a bare NAME= with nothing after it is not stripped to empty', () => {
    expect(prepareByokSecret('cursor', 'ABCDEFGH=')).toEqual({ ok: true, value: 'ABCDEFGH=', removed: [] })
  })

  it('is idempotent: normalizing a normalized key changes nothing', () => {
    for (const raw of ['OPENAI_API_KEY=sk-proj-FAKE0001', 'export X="sk-ant-FAKE0002"', "'fc-FAKE0003'"]) {
      for (const provider of ['openai', 'anthropic', 'firecrawl']) {
        const once = prepareByokSecret(provider, raw)
        if (!once.ok) continue
        expect(prepareByokSecret(provider, once.value)).toEqual({ ok: true, value: once.value, removed: [] })
      }
    }
  })
})

describe('per-provider prefixes and wrong-provider detection', () => {
  it('accepts each provider’s own format', () => {
    for (const [provider, key] of [
      ['anthropic', 'sk-ant-FAKE0010'],
      ['openai', 'sk-FAKE00000011'],
      ['openai', 'sk-proj-FAKE0012'],
      ['firecrawl', 'fc-FAKE00000013'],
      ['supabase', 'sbp_FAKE00000014'],
    ]) {
      expect(prepareByokSecret(provider, key), `${provider} ${key}`).toMatchObject({ ok: true })
    }
  })

  it('says which row a key from another provider belongs in', () => {
    expect(prepareByokSecret('openai', 'sk-ant-FAKE0015')).toEqual({
      ok: false,
      message: 'This looks like an Anthropic key — paste it in the Anthropic row.',
    })
    expect(prepareByokSecret('anthropic', 'sk-proj-FAKE0016')).toEqual({
      ok: false,
      message: 'This looks like an OpenAI key — paste it in the OpenAI / OpenRouter row.',
    })
    expect(prepareByokSecret('anthropic', 'fc-FAKE00000017')).toEqual({
      ok: false,
      message: 'This looks like a Firecrawl key — paste it in the Firecrawl row.',
    })
    expect(prepareByokSecret('firecrawl', 'sbp_FAKE00000018')).toEqual({
      ok: false,
      message: 'This looks like a Supabase key — paste it in the Supabase row.',
    })
    expect(prepareByokSecret('anthropic', 'sk-or-v1-FAKE0019')).toEqual({
      ok: false,
      message: 'This looks like an OpenRouter key — paste it in the OpenAI / OpenRouter row.',
    })
  })

  it('names the expected prefix when nothing matches', () => {
    expect(prepareByokSecret('anthropic', 'no_prefix_FAKE0020')).toEqual({
      ok: false,
      message: 'An Anthropic key starts with "sk-ant-". Copy it from console.anthropic.com/settings/keys.',
    })
    expect(prepareByokSecret('firecrawl', 'no_prefix_FAKE0021')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^A Firecrawl key starts with "fc-"/),
    })
  })

  it('an OpenRouter key in the OpenAI row needs the base URL', () => {
    expect(prepareByokSecret('openai', 'sk-or-v1-FAKE0022')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/OpenRouter key\. Set the base URL/),
    })
    expect(
      prepareByokSecret('openai', 'sk-or-v1-FAKE0022', { baseUrl: 'https://openrouter.ai/api/v1' }),
    ).toMatchObject({ ok: true })
  })

  it('explains a Supabase secret key or project JWT pasted in the Supabase row', () => {
    expect(prepareByokSecret('supabase', 'sb_secret_FAKE0023')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^This is a Supabase project secret key, not an access token\..*starts with "sbp_"/),
    })
    expect(prepareByokSecret('supabase', 'eyJhbGciOiJIUzI1NiJ9.FAKE.FAKE')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^This is a Supabase project JWT \(anon or service_role key\)/),
    })
  })

  it('providers without a confirmed format only get distinctive wrong-provider checks', () => {
    // Cursor / Browserbase formats are not confirmed: no prefix is enforced,
    // and a bare "sk-" is too broad to accuse.
    expect(prepareByokSecret('cursor', 'crsr_FAKE00000024')).toMatchObject({ ok: true })
    expect(prepareByokSecret('browserbase', 'bb_live_FAKE0025')).toMatchObject({ ok: true })
    expect(prepareByokSecret('browserbase', 'sk-FAKE00000026')).toMatchObject({ ok: true })
    expect(prepareByokSecret('cursor', 'sk-ant-FAKE0027')).toMatchObject({
      ok: false,
      message: 'This looks like an Anthropic key — paste it in the Anthropic row.',
    })
  })
})

describe('console mirror parity', () => {
  it('the body below the marker is byte-identical', () => {
    expect(body('apps/admin/src/lib/byokKeyRules.ts')).toBe(
      body('packages/server/supabase/functions/_shared/byok-key-rules.ts'),
    )
  })

  it('both copies answer every case the same way', () => {
    const providers = ['anthropic', 'openai', 'firecrawl', 'supabase', 'cursor', 'browserbase']
    const inputs = [
      'OPENAI_API_KEY=sk-proj-FAKE0001',
      'export X="sk-ant-FAKE0002"',
      'fc-FAKE00000003',
      'sbp_FAKE00000004',
      'sb_secret_FAKE0005',
      'sk-or-v1-FAKE0006',
      'sk-FAKE0000000007',
      'has space FAKE',
      '',
      'short',
    ]
    for (const provider of providers) {
      for (const raw of inputs) {
        for (const baseUrl of [null, 'https://openrouter.ai/api/v1']) {
          expect(adminPrepareByokSecret(provider, raw, { baseUrl })).toEqual(
            prepareByokSecret(provider, raw, { baseUrl }),
          )
        }
      }
    }
  })
})
