// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { MAX_SKILL_CHARS } from './packet.js'
import { chainSkills } from './skills.js'

const skill = (name: string, paragraphs: number) => ({
  name,
  text: Array.from({ length: paragraphs }, (_, i) => `${name} rule ${i}: ${'keep tap targets at least 44 px and say why. '.repeat(6)}`).join('\n\n'),
  files: { 'references/notes.md': Buffer.from(`${name} notes`) },
  source: 'npm:@kensaurus/skills@2.5.0',
  related: [],
})

// Three chained skills were 33K characters and the prompt kept the first 12K (2026-10-07).
describe('a chain of long skills', () => {
  const chain = chainSkills([skill('enhance-mobile-native-feel', 60), skill('enhance-ux-laws', 50), skill('housekeep-design', 40)])

  it('fits the prompt and gives every skill a share of it', () => {
    expect(chain.text.length).toBeLessThanOrEqual(MAX_SKILL_CHARS)
    const kept = chain.text.slice(0, MAX_SKILL_CHARS)
    for (const n of ['enhance-mobile-native-feel', 'enhance-ux-laws', 'housekeep-design']) {
      expect(kept).toContain(`## Skill`)
      expect(kept).toContain(`${n} rule 0:`)
      expect(kept).toContain(`Read ${n}/SKILL.md for the rest.`)
    }
  })

  it('puts each whole skill and its references in a folder named after it', () => {
    expect(chain.files['housekeep-design/SKILL.md'].toString()).toContain('housekeep-design rule 39:')
    expect(chain.files['enhance-ux-laws/references/notes.md'].toString()).toBe('enhance-ux-laws notes')
  })

  it('leaves a short skill whole', () => {
    const short = chainSkills([skill('a-skill', 1), skill('b-skill', 1)])
    expect(short.text).not.toContain('Shortened here')
  })
})
