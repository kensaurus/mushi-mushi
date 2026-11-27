/**
 * Project personas (ADR 0073, Plan 025 P3), the console side: the studio's live
 * preview must show the brief the server will send the visitor model, character
 * for character, and the editor must send only what the server accepts.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AVATAR_ACCENTS,
  avatarAccent,
  avatarInitials,
  avatarLabel,
  budgetLine,
  createBody,
  DEVICE_LINE,
  draftBrief,
  draftErrors,
  draftFrom,
  EXPERTISE_LINE,
  lastResult,
  NEED_LINE,
  PERSONA_BRIEF_MAX,
  PERSONA_NEEDS,
  patchBody,
  personaBrief,
  personaTries,
  personaViewport,
  ttfvSeries,
  type PersonaFields,
  type PersonaRun,
} from './personas'

const JAPANESE: PersonaFields = {
  name: 'Japanese visitor',
  preset: 'japanese_user',
  goal: null,
  locale: 'ja-JP',
  device: 'mobile',
  expertise: 'casual',
  accessibility: [],
  patienceSteps: 30,
  costCapUsd: 1,
  notes: null,
}

const SCREEN_READER: PersonaFields = {
  name: 'Screen-reader user',
  preset: 'screen_reader_user',
  goal: null,
  locale: 'en-US',
  device: 'desktop',
  expertise: 'casual',
  accessibility: ['screen_reader', 'keyboard_only'],
  patienceSteps: 40,
  costCapUsd: 1,
  notes: null,
}

describe('personaBrief', () => {
  it('reads like the server brief for the presets', () => {
    expect(personaBrief(JAPANESE)).toBe(
      'You are "Japanese visitor". You use a few apps like this now and then. You are on a phone, tapping with your thumb. You read Japanese (ja-JP) best; text in another language slows you down. You give up after about 30 steps if you are not getting closer.',
    )
    expect(personaBrief(SCREEN_READER)).toBe(
      'You are "Screen-reader user". You use a few apps like this now and then. You are on a laptop with a mouse. You use a screen reader: you know only what is announced (headings, labels, button names), never how things look. You move with Tab, Enter and Escape when you can. You give up after about 40 steps if you are not getting closer.',
    )
  })

  it('adds notes, and cuts at 600 characters with an ellipsis', () => {
    expect(personaBrief({ ...SCREEN_READER, accessibility: [], notes: 'Uses a work laptop.' })).toMatch(/ Also: Uses a work laptop\.$/)
    const everything = { ...JAPANESE, locale: 'xx-YY', accessibility: [...PERSONA_NEEDS], notes: 'n'.repeat(400) }
    const brief = personaBrief(everything)
    expect(brief).toHaveLength(PERSONA_BRIEF_MAX)
    expect(brief.endsWith('…')).toBe(true)
    // An unknown language is named by its code.
    expect(brief).toContain('You read xx-YY (xx-YY) best')
  })

  it('uses the same words as the server, line for line', () => {
    const server = readFileSync(resolve(__dirname, '../../../../packages/server/supabase/functions/_shared/personas.ts'), 'utf8')
    for (const table of [EXPERTISE_LINE, DEVICE_LINE, NEED_LINE] as Array<Record<string, string>>) {
      for (const [key, line] of Object.entries(table)) expect(server, key).toContain(`${key}: '${line}'`)
    }
    for (const piece of [
      'parts = [`You are "${p.name.slice(0, 60)}".`, EXPERTISE_LINE[p.expertise], DEVICE_LINE[p.device]]',
      "if (!p.locale.toLowerCase().startsWith('en')) parts.push(`You read ${languageName(p.locale)} (${p.locale}) best; text in another language slows you down.`)",
      'parts.push(`You give up after about ${p.patienceSteps} steps if you are not getting closer.`)',
      'if (p.notes) parts.push(`Also: ${p.notes.slice(0, 160)}`)',
      "const brief = parts.join(' ')",
      'return brief.length <= PERSONA_BRIEF_MAX ? brief : `${brief.slice(0, PERSONA_BRIEF_MAX - 1)}…`',
      'export const PERSONA_BRIEF_MAX = 600',
    ]) {
      expect(server).toContain(piece)
    }
  })

  it('previews a draft as the server will save it: spaces collapsed, needs in order', () => {
    const draft = { ...draftFrom(SCREEN_READER), name: '  Screen-reader   user ', accessibility: ['keyboard_only', 'screen_reader'] as PersonaFields['accessibility'] }
    expect(draftBrief(draft)).toBe(personaBrief(SCREEN_READER))
  })
})

describe('the editor body', () => {
  it('creates with exactly the ten fields, empty text as null', () => {
    const body = createBody({ ...draftFrom(JAPANESE), goal: '  ', notes: '' })
    expect(Object.keys(body).sort()).toEqual(['accessibility', 'costCapUsd', 'device', 'expertise', 'goal', 'locale', 'name', 'notes', 'patienceSteps', 'preset'])
    expect(body).toMatchObject({ goal: null, notes: null })
  })

  it('patches only what changed, and nothing when nothing did', () => {
    expect(patchBody(JAPANESE, draftFrom(JAPANESE))).toBeNull()
    expect(patchBody(JAPANESE, { ...draftFrom(JAPANESE), patienceSteps: 12, goal: 'sign up' })).toEqual({ patienceSteps: 12, goal: 'sign up' })
    expect(patchBody(SCREEN_READER, { ...draftFrom(SCREEN_READER), accessibility: ['keyboard_only', 'screen_reader'] })).toBeNull()
  })

  it('refuses what the server would refuse, in its words', () => {
    const ok = draftFrom(JAPANESE)
    expect(draftErrors(ok)).toEqual({})
    expect(draftErrors({ ...ok, name: '   ' }).name).toContain('Give the persona a name')
    expect(draftErrors({ ...ok, locale: 'Japanese' }).locale).toContain('en-US or ja-JP')
    expect(draftErrors({ ...ok, patienceSteps: 4 }).patienceSteps).toContain('5 to 80')
    expect(draftErrors({ ...ok, costCapUsd: 25 }).costCapUsd).toContain('$0.05 to $20')
    expect(draftErrors({ ...ok, goal: '--mint-account' }).goal).toBeDefined()
  })
})

describe('what the visitor gets', () => {
  it('a viewport per device, zoomed 150% for low vision', () => {
    expect(personaViewport({ device: 'desktop', accessibility: [] })).toMatchObject({ width: 1280, height: 800, touch: false, label: 'Laptop, 1280×800' })
    expect(personaViewport({ device: 'tablet', accessibility: [] })).toMatchObject({ width: 820, height: 1180, label: 'Tablet, 820×1180, touch' })
    expect(personaViewport({ device: 'mobile', accessibility: [] })).toMatchObject({ width: 390, height: 844, label: 'Phone, 390×844, touch' })
    expect(personaViewport({ device: 'desktop', accessibility: ['low_vision'] })).toMatchObject({ width: 853, height: 533, zoom: 1.5, label: 'Laptop at 150% zoom, 853×533 CSS px' })
  })

  it('lists what it will try, the goal last', () => {
    const tries = personaTries({ ...SCREEN_READER, goal: 'sign up and add a photo.' })
    expect(tries).toEqual([
      'Laptop, 1280×800',
      'Browser language en-US',
      'Knows only what a screen reader announces',
      'Moves only with Tab, Enter and Escape',
      'Stops after 40 steps',
      'Spends at most $1 of AI budget a test',
      'Tries to sign up and add a photo',
    ])
    expect(personaTries({ ...JAPANESE, costCapUsd: 0.5 })).toEqual([
      'Phone, 390×844, touch',
      'Browser language ja-JP (Japanese)',
      'Stops after 30 steps',
      'Spends at most $0.50 of AI budget a test',
      'Tries the goal you type on the test page',
    ])
  })
})

describe('the avatar', () => {
  it('takes one or two initials', () => {
    expect(avatarInitials('Japanese visitor')).toBe('JV')
    expect(avatarInitials('Screen-reader user')).toBe('SU')
    expect(avatarInitials('maria')).toBe('M')
    expect(avatarInitials('  ')).toBe('?')
    expect(avatarInitials('ゆき さん')).toBe('ゆさ')
  })

  it('gives a name the same hue every time, from hues that mean no state', () => {
    expect(avatarAccent('Japanese visitor')).toBe(avatarAccent('Japanese visitor'))
    const names = ['First-time visitor', 'Power user', 'Older visitor', 'Japanese visitor', 'Screen-reader user', 'Impatient phone user', 'A', 'B', 'C']
    const hues = new Set(names.map(avatarAccent))
    for (const h of hues) expect(AVATAR_ACCENTS).toContain(h)
    expect(hues.size).toBeGreaterThan(1)
  })

  it('names the visitor for a screen reader', () => {
    expect(avatarLabel(JAPANESE)).toBe('Japanese visitor: phone, reads Japanese')
    expect(avatarLabel(SCREEN_READER)).toBe('Screen-reader user: laptop, screen reader, keyboard only')
  })
})

describe('a persona’s tests', () => {
  const run = (over: Partial<PersonaRun>): PersonaRun => ({
    local_run_id: 'r',
    persona_id: 'p',
    status: 'done',
    started_at: '2026-11-20T00:00:00Z',
    finished_at: '2026-11-20T00:20:00Z',
    ttfv_seconds: 41,
    reached: 2,
    steps: 9,
    dry_run: false,
    counts: { sessions: 3 },
    ...over,
  })

  it('draws time to first value oldest first, finished sign-up tests only', () => {
    const runs = [run({ ttfv_seconds: 30 }), run({ dry_run: true, ttfv_seconds: 5 }), run({ status: 'failed', ttfv_seconds: null }), run({ ttfv_seconds: 90 })]
    expect(ttfvSeries(runs)).toEqual([90, 30])
  })

  it('says how the last test went', () => {
    expect(lastResult([])).toEqual({ status: 'idle', text: 'No tests yet' })
    expect(lastResult([run({})])).toEqual({ status: 'passed', text: 'Reached the goal 2 of 3 · 41 s to first value' })
    expect(lastResult([run({ reached: 0, ttfv_seconds: null })])).toEqual({ status: 'failed', text: 'Stalled' })
    expect(lastResult([run({ status: 'queued' }), run({})]).status).toBe('waiting')
  })

  it('puts the month’s budget in one line', () => {
    expect(budgetLine(null)).toContain('Budget unknown')
    expect(budgetLine({ monthlyUsd: null, spentUsd: 0, heldUsd: null, resetsAt: '' })).toContain('No monthly AI budget')
    expect(budgetLine({ monthlyUsd: 20, spentUsd: 3.5, heldUsd: 1, resetsAt: '' })).toBe('This month: $3.50 of $20 · $1 held by running tests')
  })
})
