/**
 * FILE: packages/server/supabase/functions/_shared/personas.ts
 * PURPOSE: Project personas (ADR 0073, Plan 025 P3): who a first-time user
 *          test (fresh eyes) or a PDCA critic plays. A persona is a user
 *          profile the project keeps (project_personas), next to the five
 *          rubric critics (agent_personas): a name, what they came to do, the
 *          language they read, the device they hold, how much they know, what
 *          they need to use an app, how patient they are (a step cap) and what
 *          one run may spend (a cost cap).
 *
 *          The parts with no I/O: what the console may save, the presets, the
 *          short brief the visitor model and the critic read, and the run a
 *          persona shapes. A brief is plain words, about 400 characters: it
 *          costs a few dozen tokens a step, never a second model call.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 * The reads and writes are in api/routes/personas.ts.
 */

export const PERSONA_DEVICES = ['desktop', 'mobile', 'tablet'] as const
export type PersonaDevice = (typeof PERSONA_DEVICES)[number]

export const PERSONA_EXPERTISE = ['new', 'casual', 'power'] as const
export type PersonaExpertise = (typeof PERSONA_EXPERTISE)[number]

export const PERSONA_NEEDS = ['screen_reader', 'low_vision', 'keyboard_only', 'reduced_motion', 'color_blind', 'motor', 'plain_language'] as const
export type PersonaNeed = (typeof PERSONA_NEEDS)[number]

export const PERSONA_PRESET_IDS = ['first_time', 'power_user', 'older_user', 'japanese_user', 'screen_reader_user', 'impatient_mobile'] as const
export type PersonaPresetId = (typeof PERSONA_PRESET_IDS)[number]

/** Personas one project may keep (live, not archived). */
export const PERSONAS_PER_PROJECT_MAX = 24
export const PERSONA_STEPS_MIN = 5
export const PERSONA_STEPS_MAX = 80
export const PERSONA_COST_CAP_MIN_USD = 0.05
export const PERSONA_COST_CAP_MAX_USD = 20
export const PERSONA_COST_CAP_DEFAULT_USD = 1
/** The brief the visitor model reads, at most. */
export const PERSONA_BRIEF_MAX = 600

export interface PersonaInput {
  name: string
  preset: PersonaPresetId | null
  /** What this user came to do; the test's goal when the console leaves it as the persona's. */
  goal: string | null
  /** BCP 47, e.g. en-US, ja-JP: the browser's language and the language the visitor reads. */
  locale: string
  device: PersonaDevice
  expertise: PersonaExpertise
  accessibility: PersonaNeed[]
  /** Steps a visitor takes before giving up. */
  patienceSteps: number
  /** What one run may spend on Mushi's LLM calls (scoring, classifying what it files). */
  costCapUsd: number
  notes: string | null
}

/** A project_personas row as the API returns it. */
export interface PersonaRow {
  id: string
  project_id: string
  name: string
  preset: PersonaPresetId | null
  goal: string | null
  locale: string
  device: PersonaDevice
  expertise: PersonaExpertise
  accessibility: PersonaNeed[]
  patience_steps: number
  cost_cap_usd: number | string
  notes: string | null
  created_at: string
  updated_at: string
  archived_at?: string | null
}

export interface PersonaPreset extends PersonaInput {
  id: PersonaPresetId
  /** One line for the preset picker. */
  blurb: string
}

/** Sensible starting points; each is an ordinary persona once saved. */
export const PERSONA_PRESETS: readonly PersonaPreset[] = [
  {
    id: 'first_time',
    blurb: 'Has never heard of the app and arrives from a link.',
    name: 'First-time visitor',
    preset: 'first_time',
    goal: null,
    locale: 'en-US',
    device: 'desktop',
    expertise: 'new',
    accessibility: [],
    patienceSteps: 30,
    costCapUsd: 1,
    notes: null,
  },
  {
    id: 'power_user',
    blurb: 'Knows tools like this well, skims, and expects shortcuts.',
    name: 'Power user',
    preset: 'power_user',
    goal: null,
    locale: 'en-US',
    device: 'desktop',
    expertise: 'power',
    accessibility: ['keyboard_only'],
    patienceSteps: 60,
    costCapUsd: 2,
    notes: null,
  },
  {
    id: 'older_user',
    blurb: 'Reads slowly at 150% zoom on a tablet; plain words help.',
    name: 'Older visitor',
    preset: 'older_user',
    goal: null,
    locale: 'en-US',
    device: 'tablet',
    expertise: 'new',
    accessibility: ['low_vision', 'plain_language'],
    patienceSteps: 25,
    costCapUsd: 1,
    notes: null,
  },
  {
    id: 'japanese_user',
    blurb: 'Reads Japanese on a phone; English-only screens slow them down.',
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
  },
  {
    id: 'screen_reader_user',
    blurb: 'Hears the page through a screen reader and uses the keyboard.',
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
  },
  {
    id: 'impatient_mobile',
    blurb: 'On a phone between other things; leaves after a few taps.',
    name: 'Impatient phone user',
    preset: 'impatient_mobile',
    goal: null,
    locale: 'en-US',
    device: 'mobile',
    expertise: 'casual',
    accessibility: ['reduced_motion'],
    patienceSteps: 12,
    costCapUsd: 0.5,
    notes: null,
  },
]

export function personaPreset(id: unknown): PersonaPreset | null {
  return PERSONA_PRESETS.find((p) => p.id === id) ?? null
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

const CONTROL = /[\u0000-\u001f\u007f]/
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isPersonaId(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw)
}

function plain(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.replace(/\s+/g, ' ').trim()
  if (!s || s.length > max || CONTROL.test(s)) return null
  return s
}

const FIELDS = new Set(['name', 'preset', 'goal', 'locale', 'device', 'expertise', 'accessibility', 'patienceSteps', 'costCapUsd', 'notes'])

/**
 * What the console may save. `partial` (PATCH) checks only the fields sent;
 * otherwise a missing field takes the preset's value, else the default. An
 * unknown field is refused, never dropped.
 */
export function parsePersonaInput(raw: unknown, opts: { partial?: boolean } = {}): Parsed<Partial<PersonaInput>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Send a JSON body.' }
  const b = raw as Record<string, unknown>
  const unknown = Object.keys(b).find((k) => !FIELDS.has(k))
  if (unknown) return { ok: false, message: `Unknown field "${unknown.slice(0, 40)}".` }
  const out: Partial<PersonaInput> = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined

  let base: PersonaInput | null = null
  if (has('preset') && b.preset !== null) {
    const p = personaPreset(b.preset)
    if (!p) return { ok: false, message: `There is no preset called "${String(b.preset).slice(0, 40)}".` }
    base = p
    out.preset = p.id
  } else if (has('preset')) {
    out.preset = null
  }

  if (has('name')) {
    const name = plain(b.name, 60)
    if (!name) return { ok: false, message: 'Give the persona a name (up to 60 characters).' }
    out.name = name
  }
  if (has('goal')) {
    if (b.goal === null || b.goal === '') out.goal = null
    else {
      const goal = plain(b.goal, 300)
      if (!goal || goal.startsWith('-')) return { ok: false, message: 'The goal is a few plain words (up to 300 characters).' }
      out.goal = goal
    }
  }
  if (has('locale')) {
    if (typeof b.locale !== 'string' || b.locale.length > 35 || !LOCALE_RE.test(b.locale)) return { ok: false, message: 'The language is a code like en-US or ja-JP.' }
    out.locale = b.locale
  }
  if (has('device')) {
    if (!(PERSONA_DEVICES as readonly unknown[]).includes(b.device)) return { ok: false, message: `The device is one of ${PERSONA_DEVICES.join(', ')}.` }
    out.device = b.device as PersonaDevice
  }
  if (has('expertise')) {
    if (!(PERSONA_EXPERTISE as readonly unknown[]).includes(b.expertise)) return { ok: false, message: `How much they know is one of ${PERSONA_EXPERTISE.join(', ')}.` }
    out.expertise = b.expertise as PersonaExpertise
  }
  if (has('accessibility')) {
    if (!Array.isArray(b.accessibility) || b.accessibility.some((n) => !(PERSONA_NEEDS as readonly unknown[]).includes(n))) {
      return { ok: false, message: `Accessibility needs come from: ${PERSONA_NEEDS.join(', ')}.` }
    }
    out.accessibility = [...new Set(b.accessibility as PersonaNeed[])].sort((a, z) => PERSONA_NEEDS.indexOf(a) - PERSONA_NEEDS.indexOf(z))
  }
  if (has('patienceSteps')) {
    const n = b.patienceSteps
    if (typeof n !== 'number' || !Number.isInteger(n) || n < PERSONA_STEPS_MIN || n > PERSONA_STEPS_MAX) {
      return { ok: false, message: `Patience is a whole number of steps from ${PERSONA_STEPS_MIN} to ${PERSONA_STEPS_MAX}.` }
    }
    out.patienceSteps = n
  }
  if (has('costCapUsd')) {
    const n = b.costCapUsd
    if (typeof n !== 'number' || !Number.isFinite(n) || n < PERSONA_COST_CAP_MIN_USD || n > PERSONA_COST_CAP_MAX_USD) {
      return { ok: false, message: `The cost cap is from $${PERSONA_COST_CAP_MIN_USD.toFixed(2)} to $${PERSONA_COST_CAP_MAX_USD} a run.` }
    }
    out.costCapUsd = Math.round(n * 100) / 100
  }
  if (has('notes')) {
    if (b.notes === null || b.notes === '') out.notes = null
    else {
      const notes = plain(b.notes, 500)
      if (!notes) return { ok: false, message: 'Notes are plain text, up to 500 characters.' }
      out.notes = notes
    }
  }

  if (opts.partial) {
    if (Object.keys(out).length === 0) return { ok: false, message: 'Nothing to change.' }
    return { ok: true, value: out }
  }
  const d = base ?? PERSONA_PRESETS[0]!
  const value: PersonaInput = {
    name: out.name ?? (base ? base.name : ''),
    preset: out.preset ?? null,
    goal: out.goal !== undefined ? out.goal : d.goal,
    locale: out.locale ?? d.locale,
    device: out.device ?? d.device,
    expertise: out.expertise ?? d.expertise,
    accessibility: out.accessibility ?? [...d.accessibility],
    patienceSteps: out.patienceSteps ?? d.patienceSteps,
    costCapUsd: out.costCapUsd ?? d.costCapUsd,
    notes: out.notes !== undefined ? out.notes : null,
  }
  if (!value.name) return { ok: false, message: 'Give the persona a name (up to 60 characters).' }
  return { ok: true, value }
}

/** The project_personas columns an input writes. */
export function personaColumns(p: Partial<PersonaInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (p.name !== undefined) out.name = p.name
  if (p.preset !== undefined) out.preset = p.preset
  if (p.goal !== undefined) out.goal = p.goal
  if (p.locale !== undefined) out.locale = p.locale
  if (p.device !== undefined) out.device = p.device
  if (p.expertise !== undefined) out.expertise = p.expertise
  if (p.accessibility !== undefined) out.accessibility = p.accessibility
  if (p.patienceSteps !== undefined) out.patience_steps = p.patienceSteps
  if (p.costCapUsd !== undefined) out.cost_cap_usd = p.costCapUsd
  if (p.notes !== undefined) out.notes = p.notes
  return out
}

export function personaFromRow(r: PersonaRow): PersonaInput & { id: string } {
  return {
    id: r.id,
    name: r.name,
    preset: r.preset,
    goal: r.goal,
    locale: r.locale,
    device: r.device,
    expertise: r.expertise,
    accessibility: [...(r.accessibility ?? [])],
    patienceSteps: r.patience_steps,
    costCapUsd: Number(r.cost_cap_usd),
    notes: r.notes,
  }
}

// ── The brief ───────────────────────────────────────────────────────────────

const EXPERTISE_LINE: Record<PersonaExpertise, string> = {
  new: 'You rarely use apps like this and do not know its words yet.',
  casual: 'You use a few apps like this now and then.',
  power: 'You use tools like this every day, skim, and look for the fastest way.',
}

const DEVICE_LINE: Record<PersonaDevice, string> = {
  desktop: 'You are on a laptop with a mouse.',
  mobile: 'You are on a phone, tapping with your thumb.',
  tablet: 'You are on a tablet, tapping.',
}

const NEED_LINE: Record<PersonaNeed, string> = {
  screen_reader: 'You use a screen reader: you know only what is announced (headings, labels, button names), never how things look.',
  low_vision: 'You read at 150% zoom; small or low-contrast text is hard for you.',
  keyboard_only: 'You move with Tab, Enter and Escape when you can.',
  reduced_motion: 'Moving, sliding or flashing things bother you.',
  color_blind: 'You cannot tell red from green; colour alone tells you nothing.',
  motor: 'Small or close-together buttons are hard for you to hit.',
  plain_language: 'Long or technical words slow you down; you look for plain ones.',
}

/** English name of a locale's language, for the brief; the code when unknown. */
export function languageName(locale: string): string {
  const lang = locale.split('-')[0]!.toLowerCase()
  const names: Record<string, string> = {
    en: 'English', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian',
    nl: 'Dutch', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', tr: 'Turkish', pl: 'Polish', sv: 'Swedish',
  }
  return names[lang] ?? locale
}

/**
 * Who the visitor is, in plain words, for the visitor model's prompt and the
 * PDCA critic. Never longer than PERSONA_BRIEF_MAX. Names and notes are the
 * project's own words, so they are kept short and on one line.
 */
export function personaBrief(p: Pick<PersonaInput, 'name' | 'locale' | 'device' | 'expertise' | 'accessibility' | 'patienceSteps' | 'notes'>): string {
  const parts = [`You are "${p.name.slice(0, 60)}".`, EXPERTISE_LINE[p.expertise], DEVICE_LINE[p.device]]
  if (!p.locale.toLowerCase().startsWith('en')) parts.push(`You read ${languageName(p.locale)} (${p.locale}) best; text in another language slows you down.`)
  for (const n of p.accessibility) parts.push(NEED_LINE[n])
  parts.push(`You give up after about ${p.patienceSteps} steps if you are not getting closer.`)
  if (p.notes) parts.push(`Also: ${p.notes.slice(0, 160)}`)
  const brief = parts.join(' ')
  return brief.length <= PERSONA_BRIEF_MAX ? brief : `${brief.slice(0, PERSONA_BRIEF_MAX - 1)}…`
}

/**
 * The persona as a worker claim carries it to `mushi-ux fresh-eyes` (and the
 * CLI checks again): the brief, the device, the language, the needs that
 * change the browser, and the step cap.
 */
export interface ClaimPersona {
  id: string
  name: string
  brief: string
  locale: string
  device: PersonaDevice
  needs: PersonaNeed[]
  steps: number
}

export function claimPersona(p: PersonaInput & { id: string }): ClaimPersona {
  return {
    id: p.id,
    name: p.name,
    brief: personaBrief(p),
    locale: p.locale,
    device: p.device,
    needs: [...p.accessibility],
    steps: Math.max(PERSONA_STEPS_MIN, Math.min(PERSONA_STEPS_MAX, p.patienceSteps)),
  }
}

const CRITIC_EXPERTISE: Record<PersonaExpertise, string> = { new: 'new to apps like this', casual: 'an occasional user of apps like this', power: 'an expert who skims and wants the fastest way' }
const CRITIC_DEVICE: Record<PersonaDevice, string> = { desktop: 'a laptop', mobile: 'a phone', tablet: 'a tablet' }
const CRITIC_NEED: Record<PersonaNeed, string> = {
  screen_reader: 'uses a screen reader (only announced text counts)',
  low_vision: 'reads at 150% zoom',
  keyboard_only: 'uses the keyboard',
  reduced_motion: 'is bothered by motion',
  color_blind: 'cannot tell red from green',
  motor: 'struggles with small targets',
  plain_language: 'needs plain words',
}

/** The PDCA critic's lens: who it judges the page for, appended to its rubric persona's prompt. */
export function criticPersonaBrief(p: Pick<PersonaInput, 'name' | 'goal' | 'locale' | 'device' | 'expertise' | 'accessibility' | 'patienceSteps'>): string {
  const traits = [`${CRITIC_EXPERTISE[p.expertise]}, on ${CRITIC_DEVICE[p.device]}`]
  if (!p.locale.toLowerCase().startsWith('en')) traits.push(`reads ${languageName(p.locale)} (${p.locale}) best`)
  for (const n of p.accessibility) traits.push(CRITIC_NEED[n])
  traits.push(`gives up after about ${p.patienceSteps} steps`)
  const goal = p.goal ? ` They came to: ${p.goal.slice(0, 200)}.` : ''
  return `Judge the page for this user: "${p.name.slice(0, 60)}", ${traits.join('; ')}.${goal} Score lower where this user would stall.`
}
