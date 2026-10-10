/**
 * Skill pipelines run a root skill and its chain. Every workflow skill used to
 * sync with an empty chain: skill-sync only read `skills/<slug>/SKILL.md`
 * paths, and the skills now hand off with "Read the `x` skill". The chain is
 * declared in the spec's `metadata` map; body mentions are the fallback.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  capSkillDescription,
  parseChainSlugs,
  parseFrontmatter,
  SKILL_DESCRIPTION_MAX,
} from '../../supabase/functions/_shared/skill-frontmatter.ts'

const known = new Set(['debug-error', 'test-playwright', 'workflow-pr', 'deploy-verify', 'workflow-fix-and-ship'])

describe('parseFrontmatter metadata map', () => {
  it('reads indented metadata keys as metadata.<key>', () => {
    const raw = `---\nname: workflow-fix-and-ship\ndescription: >\n  Fix and ship.\nmetadata:\n  chain: "debug-error test-playwright workflow-pr"\n  version: "2.5.0"\nlicense: MIT\n---\n# Body`
    const parsed = parseFrontmatter(raw)!
    expect(parsed.frontmatter['metadata.chain']).toBe('debug-error test-playwright workflow-pr')
    expect(parsed.frontmatter['metadata.version']).toBe('2.5.0')
    expect(parsed.frontmatter.license).toBe('MIT')
    expect(parsed.frontmatter.description).toBe('Fix and ship.')
  })

  it('tolerates CRLF line endings', () => {
    const parsed = parseFrontmatter('---\r\nname: a-b\r\ndescription: d\r\nmetadata:\r\n  chain: "x-y"\r\n---\r\nbody')!
    expect(parsed.frontmatter.name).toBe('a-b')
    expect(parsed.frontmatter['metadata.chain']).toBe('x-y')
  })
})

describe('parseChainSlugs', () => {
  it('uses metadata.chain as the order, dropping unknown slugs and itself', () => {
    const chain = parseChainSlugs('Read the `deploy-verify` skill.', { 'metadata.chain': 'debug-error, workflow-fix-and-ship nope workflow-pr' }, {
      selfSlug: 'workflow-fix-and-ship',
      knownSlugs: known,
    })
    expect(chain).toEqual(['debug-error', 'workflow-pr'])
  })

  it('falls back to "Read the `x` skill" hand-offs in body order', () => {
    const body = [
      '1. ROOT CAUSE',
      '> Read the `debug-error` skill and follow it.',
      '4. VERIFY',
      '> Read the `test-playwright` skill and follow it.',
      '5. PR — Read `skills/workflow-pr/SKILL.md`.',
      'Read the `README` skill first.',
    ].join('\n')
    expect(parseChainSlugs(body, {}, { selfSlug: 'workflow-fix-and-ship', knownSlugs: known })).toEqual([
      'debug-error',
      'test-playwright',
      'workflow-pr',
    ])
  })

  it('an empty metadata.chain means no chain, even with body mentions', () => {
    expect(parseChainSlugs('Read the `debug-error` skill.', { 'metadata.chain': '' }, { knownSlugs: known })).toEqual([])
  })
})

describe('parseChainSlugs body fallback', () => {
  it('is only for workflow-* skills; a guardrail read is not a step', () => {
    const body = '> Read the `debug-error` skill and follow it.'
    expect(parseChainSlugs(body, {}, { selfSlug: 'enhance-readme', knownSlugs: known })).toEqual([])
    expect(parseChainSlugs(body, {}, { selfSlug: 'workflow-x', knownSlugs: known })).toEqual(['debug-error'])
    expect(parseChainSlugs(body, { 'metadata.chain': 'debug-error' }, { selfSlug: 'enhance-readme', knownSlugs: known })).toEqual(['debug-error'])
  })
})

// The Deno test used to slice inside the test itself, so dropping the cap in
// skill-sync could not fail anything. The cap is now one helper skill-sync calls.
describe('capSkillDescription', () => {
  it('cuts a description to the spec maximum and leaves a short one alone', () => {
    expect(SKILL_DESCRIPTION_MAX).toBe(1024)
    expect(capSkillDescription('b'.repeat(2000))).toBe('b'.repeat(1024))
    expect(capSkillDescription('short')).toBe('short')
  })

  it('is what skill-sync stores', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/skill-sync/index.ts'), 'utf8')
    expect(src).toMatch(/const description = capSkillDescription\(frontmatter\.description\)/)
  })
})
