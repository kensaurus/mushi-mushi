/**
 * FILE: personas.test.ts
 * PURPOSE: Project personas (ADR 0073), with no I/O: what the console may
 *          save (a preset fills the rest; unknown fields are refused, never
 *          dropped), the brief the visitor model reads, the persona a claim
 *          carries, and the PDCA critic's lens.
 */

import { describe, expect, it } from 'vitest'
import {
  claimPersona,
  criticPersonaBrief,
  parsePersonaInput,
  personaBrief,
  personaColumns,
  personaFromRow,
  PERSONA_BRIEF_MAX,
  PERSONA_PRESETS,
  type PersonaInput,
} from '../../supabase/functions/_shared/personas.ts'

const base: PersonaInput = { name: 'Visitor', preset: null, goal: null, locale: 'en-US', device: 'desktop', expertise: 'new', accessibility: [], patienceSteps: 30, costCapUsd: 1, notes: null }

describe('parsePersonaInput', () => {
  it('fills a preset, and the fields sent win over it', () => {
    const r = parsePersonaInput({ preset: 'japanese_user' })
    expect(r.ok && r.value).toMatchObject({ name: 'Japanese visitor', preset: 'japanese_user', locale: 'ja-JP', device: 'mobile', patienceSteps: 30 })
    const own = parsePersonaInput({ preset: 'japanese_user', name: '  Commuter   in Tokyo ', patienceSteps: 15 })
    expect(own.ok && own.value).toMatchObject({ name: 'Commuter in Tokyo', locale: 'ja-JP', patienceSteps: 15 })
  })

  it('needs a name without a preset, and sorts and dedupes the needs', () => {
    expect(parsePersonaInput({ device: 'mobile' })).toEqual({ ok: false, message: expect.stringContaining('name') })
    const r = parsePersonaInput({ name: 'A', accessibility: ['keyboard_only', 'screen_reader', 'keyboard_only'] })
    expect(r.ok && r.value.accessibility).toEqual(['screen_reader', 'keyboard_only'])
  })

  it.each([
    [{ name: 'A', locale: 'Japanese' }, 'en-US'],
    [{ name: 'A', device: 'watch' }, 'device'],
    [{ name: 'A', accessibility: ['telepathy'] }, 'Accessibility'],
    [{ name: 'A', patienceSteps: 4 }, '5 to 80'],
    [{ name: 'A', patienceSteps: 81 }, '5 to 80'],
    [{ name: 'A', costCapUsd: 0.01 }, 'cost cap'],
    [{ name: 'A', costCapUsd: 25 }, 'cost cap'],
    [{ name: 'A', goal: '--mint-account' }, 'goal'],
    [{ name: 'A\u0007' }, 'name'],
    [{ name: 'A', preset: 'astronaut' }, 'preset'],
    [{ name: 'A', role: 'admin' }, 'Unknown field'],
  ])('refuses %j', (body, words) => {
    const r = parsePersonaInput(body)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toContain(words)
  })

  it('a PATCH checks only what it sends, and refuses an empty one', () => {
    expect(parsePersonaInput({ patienceSteps: 20 }, { partial: true })).toEqual({ ok: true, value: { patienceSteps: 20 } })
    expect(parsePersonaInput({}, { partial: true }).ok).toBe(false)
    expect(personaColumns({ patienceSteps: 20, costCapUsd: 0.5, goal: null })).toEqual({ patience_steps: 20, cost_cap_usd: 0.5, goal: null })
  })

  it('has six presets that each parse back to themselves', () => {
    expect(PERSONA_PRESETS.map((p) => p.id)).toEqual(['first_time', 'power_user', 'older_user', 'japanese_user', 'screen_reader_user', 'impatient_mobile'])
    for (const p of PERSONA_PRESETS) {
      const r = parsePersonaInput({ preset: p.id })
      expect(r.ok && r.value.name).toBe(p.name)
    }
  })
})

describe('personaBrief', () => {
  it('says who the visitor is in plain words, in English unless they read another language', () => {
    const b = personaBrief({ ...base, name: 'Japanese visitor', locale: 'ja-JP', device: 'mobile', expertise: 'casual' })
    expect(b).toBe(
      'You are "Japanese visitor". You use a few apps like this now and then. You are on a phone, tapping with your thumb. You read Japanese (ja-JP) best; text in another language slows you down. You give up after about 30 steps if you are not getting closer.',
    )
    expect(personaBrief(base)).not.toContain('read')
  })

  it('adds each need and the notes, and never runs long', () => {
    const b = personaBrief({ ...base, accessibility: ['screen_reader', 'low_vision'], notes: 'Uses the app on the train.' })
    expect(b).toContain('screen reader')
    expect(b).toContain('150% zoom')
    expect(b).toContain('Also: Uses the app on the train.')
    const long = personaBrief({ ...base, name: 'x'.repeat(60), accessibility: ['screen_reader', 'low_vision', 'keyboard_only', 'reduced_motion', 'color_blind', 'motor', 'plain_language'], notes: 'n'.repeat(500) })
    expect(long.length).toBeLessThanOrEqual(PERSONA_BRIEF_MAX)
  })
})

describe('claimPersona and the critic lens', () => {
  it('carries the brief, device, language, needs and the step cap', () => {
    const row = { id: 'p1', project_id: 'x', name: 'Older visitor', preset: 'older_user' as const, goal: 'book a table', locale: 'en-GB', device: 'tablet' as const, expertise: 'new' as const, accessibility: ['low_vision' as const], patience_steps: 25, cost_cap_usd: '1.00', notes: null, created_at: '', updated_at: '' }
    const p = personaFromRow(row)
    expect(p.costCapUsd).toBe(1)
    expect(claimPersona(p)).toMatchObject({ id: 'p1', name: 'Older visitor', locale: 'en-GB', device: 'tablet', needs: ['low_vision'], steps: 25 })
    expect(criticPersonaBrief(p)).toBe(
      'Judge the page for this user: "Older visitor", new to apps like this, on a tablet; reads at 150% zoom; gives up after about 25 steps. They came to: book a table. Score lower where this user would stall.',
    )
  })
})
