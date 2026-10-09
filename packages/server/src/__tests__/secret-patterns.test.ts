/**
 * `_shared/secret-patterns.ts` — the one list of secret shapes, shared
 * byte-for-byte with the CLI's bundle scan, and `scanForSecrets` on top of it.
 */
import { describe, expect, it } from 'vitest'
import { findSecrets, SECRET_LABELS, SECRET_PATTERNS } from '../../supabase/functions/_shared/secret-patterns.ts'
import { scanForSecrets } from '../../supabase/functions/_shared/secret-scan.ts'

const OPENAI = 'sk-' + 'A'.repeat(24)
const ANTHROPIC = 'sk-ant-' + 'b'.repeat(24)
const STRIPE = 'sk_live_' + 'c'.repeat(20)

describe('scanForSecrets keeps its behaviour', () => {
  it('reports the first matching label in pattern order, or null', () => {
    expect(scanForSecrets(`key=${ANTHROPIC}`)).toBe('Anthropic key')
    expect(scanForSecrets(`key=${OPENAI}`)).toBe('OpenAI-style key')
    expect(scanForSecrets('-----BEGIN RSA PRIVATE KEY-----')).toBe('private key')
    expect(scanForSecrets('postgres://u:p@db.example.com/x')).toBe('database connection string')
    expect(scanForSecrets('just words, no keys')).toBeNull()
  })

  it('every pattern has a label from SECRET_LABELS', () => {
    expect(SECRET_PATTERNS.map((p) => p.label)).toEqual([...SECRET_LABELS])
  })
})

describe('findSecrets', () => {
  it('returns every match with its 1-based line', () => {
    const text = `const a = 1\nconst k = "${OPENAI}"\n\nconst s = "${STRIPE}"\n`
    expect(findSecrets(text).map((m) => [m.label, m.line])).toEqual([['OpenAI-style key', 2], ['Stripe live key', 4]])
  })

  it('does not count a match that continues a longer word on its left (minified identifiers)', () => {
    expect(findSecrets(`var task-${'A'.repeat(24)}=1`)).toEqual([])
    expect(findSecrets(`x="${OPENAI}"`)).toHaveLength(1)
  })

  it('lets the more specific pattern claim the text (sk-ant- is not also an sk- key)', () => {
    const found = findSecrets(`k="${ANTHROPIC}"`)
    expect(found.map((m) => m.label)).toEqual(['Anthropic key'])
  })

  it('finds the current OpenAI key formats, whose bodies carry - and _ (built at runtime: no key-shaped literal in the repo)', () => {
    const body = 'Ab3_' + 'x9-Q'.repeat(10) + 'Zz'
    for (const prefix of ['proj', 'svcacct', 'admin']) {
      const key = `sk-${prefix}-${body}`
      const found = findSecrets(`const k="${key}";`)
      expect(found.map((m) => m.label)).toEqual(['OpenAI-style key'])
      // The whole key is claimed, not a 20-character tail.
      expect(found[0].value).toBe(key)
      expect(scanForSecrets(`OPENAI_API_KEY=${key}`)).toBe('OpenAI-style key')
    }
    // sk-ant- stays the Anthropic key; a short sk-proj- string is not a key.
    expect(findSecrets(`"${ANTHROPIC}"`).map((m) => m.label)).toEqual(['Anthropic key'])
    expect(findSecrets('"sk-proj-short"')).toEqual([])
  })

  it('finds a Supabase secret key, not the publishable one', () => {
    const tail = 'N7UND0Ugj' + 'KTVK-Uodkm0Hg_xSvEMPvz'
    expect(findSecrets(`createClient(url, "sb_secret_${tail}")`).map((m) => m.label)).toEqual(['Supabase secret key'])
    expect(findSecrets(`createClient(url, "sb_publishable_${tail}")`)).toEqual([])
  })

  it('stops at max', () => {
    const text = Array.from({ length: 10 }, (_, i) => `"sk-${String(i).repeat(24)}"`).join('\n')
    expect(findSecrets(text, 3)).toHaveLength(3)
  })
})

describe('secret-patterns is shared with the CLI', () => {
  it('the server and CLI copies are byte-identical', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const server = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/secret-patterns.ts'), 'utf8')
    const cli = readFileSync(resolve(__dirname, '../../../cli/src/radar/secret-patterns.ts'), 'utf8')
    expect(cli).toBe(server)
  })
})
