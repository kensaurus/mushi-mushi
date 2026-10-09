/**
 * skill-sync now uses the shared `scanForSecrets` (gap #35) instead of its own
 * five-pattern list. The shared scan must catch at least everything the old
 * list caught. The old patterns are kept here, verbatim, only as the
 * reference set; samples are assembled at runtime so no secret-shaped literal
 * sits in the source.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanForSecrets } from '../../supabase/functions/_shared/secret-scan.ts'

/** The list skill-sync carried before the switch (index.ts until 2026-10-03). */
const OLD_SKILL_SYNC_PATTERNS: ReadonlyArray<RegExp> = [
  /sk-[A-Za-z0-9]{20,}/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /ghp_[A-Za-z0-9]{36}/,
  /crsr_[A-Za-z0-9]{32,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
]

const alnum = (n: number) => 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9cD1fG3hJ5kL7nP9rS1uV3xY5'.repeat(4).slice(0, n)
const upper = (n: number) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.repeat(2).slice(0, n)

/** One sample per old pattern, at its minimum length and longer. */
const SAMPLES: ReadonlyArray<string> = [
  `key: ${'sk' + '-'}${alnum(20)}`,
  `key: ${'sk' + '-'}${alnum(48)}`,
  `AWS_ACCESS_KEY_ID=${'AK' + 'IA'}${upper(16)}`,
  `AWS_ACCESS_KEY_ID=${'AS' + 'IA'}${upper(16)}`,
  `token ${'gh' + 'p_'}${alnum(36)}`,
  `CURSOR=${'cr' + 'sr_'}${alnum(32)}`,
  `CURSOR=${'cr' + 'sr_'}${alnum(40)}`,
  `${'-----BEGIN '}PRIVATE KEY-----\nMIIE`,
  `${'-----BEGIN '}RSA PRIVATE KEY-----\nMIIE`,
  `${'-----BEGIN '}EC PRIVATE KEY-----\nMIIE`,
]

describe('scanForSecrets covers the old skill-sync patterns', () => {
  it('every sample is a real match for some old pattern (the fixture is meaningful)', () => {
    for (const s of SAMPLES) expect(OLD_SKILL_SYNC_PATTERNS.some((re) => re.test(s)), s).toBe(true)
  })

  it('the shared scan flags every sample the old list flagged', () => {
    for (const s of SAMPLES) expect(scanForSecrets(s), s).not.toBeNull()
  })

  it('still passes ordinary skill prose', () => {
    expect(scanForSecrets('# Skill: workflow-fix-and-ship\nUse `gh pr create` to open a pull request. color: sk-red')).toBeNull()
  })
})

describe('skill-sync wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/skill-sync/index.ts'), 'utf8')
  it('imports the shared scan and keeps no private pattern list', () => {
    expect(src).toContain("import { scanForSecrets } from '../_shared/secret-scan.ts'")
    expect(src).not.toMatch(/SECRET_PATTERNS\s*=/)
    expect(src).not.toContain('containsSecretPattern')
  })
})
