/**
 * FILE: apps/admin/src/lib/personas.ts
 * PURPOSE: The console side of project personas (ADR 0073, Plan 025 P3): who a
 *          first-time user test plays. The shapes GET /v1/admin/projects/:pid/personas
 *          returns, the brief the visitor model reads (byte-identical to the
 *          server's `personaBrief` in packages/server/supabase/functions/_shared/personas.ts,
 *          so the studio's live preview shows exactly what will be sent), and
 *          the small rules the studio draws a persona with: its viewport, what
 *          the visitor will try, its avatar's initials and accent, its history.
 */

import { formatSeconds } from './freshEyes'

export type PersonaDevice = 'desktop' | 'mobile' | 'tablet'

export const PERSONA_EXPERTISE = ['new', 'casual', 'power'] as const
export type PersonaExpertise = (typeof PERSONA_EXPERTISE)[number]

export const PERSONA_NEEDS = ['screen_reader', 'low_vision', 'keyboard_only', 'reduced_motion', 'color_blind', 'motor', 'plain_language'] as const
export type PersonaNeed = (typeof PERSONA_NEEDS)[number]

export type PersonaPresetId = 'first_time' | 'power_user' | 'older_user' | 'japanese_user' | 'screen_reader_user' | 'impatient_mobile'

/** The server's limits (parsePersonaInput); the editor checks the same before it sends. */
export const PERSONA_STEPS_MIN = 5
export const PERSONA_STEPS_MAX = 80
export const PERSONA_COST_CAP_MIN_USD = 0.05
export const PERSONA_COST_CAP_MAX_USD = 20
export const PERSONA_BRIEF_MAX = 600
const PERSONA_NAME_MAX = 60
const PERSONA_GOAL_MAX = 300
const PERSONA_NOTES_MAX = 500
const PERSONA_LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/

/** The ten fields a persona is saved with: the only keys POST and PATCH accept. */
export interface PersonaFields {
  name: string
  preset: PersonaPresetId | null
  goal: string | null
  locale: string
  device: PersonaDevice
  expertise: PersonaExpertise
  accessibility: PersonaNeed[]
  patienceSteps: number
  costCapUsd: number
  notes: string | null
}

/** @internal Exported for tests. */
export interface PersonaRun {
  local_run_id: string
  persona_id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'stopped'
  started_at: string
  finished_at: string | null
  ttfv_seconds: number | null
  reached: number | null
  steps: number | null
  dry_run: boolean | null
  counts: { sessions?: number } | null
}

export interface Persona extends PersonaFields {
  id: string
  /** The exact text the visitor model reads. */
  brief: string
  plays: { id: string; name: string; brief: string; locale: string; device: PersonaDevice; needs: PersonaNeed[]; steps: number }
  createdAt: string
  updatedAt: string
  /** Newest first, at most 12. Absent on a PATCH answer. */
  runs?: PersonaRun[]
}

export interface PersonaPreset extends PersonaFields {
  id: PersonaPresetId
  blurb: string
  brief: string
}

export type TestAccountMode = 'off' | 'mushi' | 'hook'

export interface TestAccountsSetting {
  mode: TestAccountMode
  hookUrl: string | null
  hasSecret: boolean
  canChange: boolean
  canUseMushi: boolean
}

interface PersonaBudget {
  monthlyUsd: number | null
  spentUsd: number
  heldUsd: number | null
  resetsAt: string
}

export interface PersonasData {
  personas: Persona[]
  presets: PersonaPreset[]
  limit: number
  canEdit: boolean
  testAccounts: TestAccountsSetting
  /** null: the budget could not be read just now. */
  budget: PersonaBudget | null
}

// ── The brief (copied from the server; personas.test.ts checks the tables match) ──

/** @internal Exported for tests (parity with the server's tables). */
export const EXPERTISE_LINE: Record<PersonaExpertise, string> = {
  new: 'You rarely use apps like this and do not know its words yet.',
  casual: 'You use a few apps like this now and then.',
  power: 'You use tools like this every day, skim, and look for the fastest way.',
}

/** @internal Exported for tests. */
export const DEVICE_LINE: Record<PersonaDevice, string> = {
  desktop: 'You are on a laptop with a mouse.',
  mobile: 'You are on a phone, tapping with your thumb.',
  tablet: 'You are on a tablet, tapping.',
}

/** @internal Exported for tests. */
export const NEED_LINE: Record<PersonaNeed, string> = {
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

/** Who the visitor is, in plain words: the server's personaBrief, character for character. */
export function personaBrief(p: Pick<PersonaFields, 'name' | 'locale' | 'device' | 'expertise' | 'accessibility' | 'patienceSteps' | 'notes'>): string {
  const parts = [`You are "${p.name.slice(0, 60)}".`, EXPERTISE_LINE[p.expertise], DEVICE_LINE[p.device]]
  if (!p.locale.toLowerCase().startsWith('en')) parts.push(`You read ${languageName(p.locale)} (${p.locale}) best; text in another language slows you down.`)
  for (const n of p.accessibility) parts.push(NEED_LINE[n])
  parts.push(`You give up after about ${p.patienceSteps} steps if you are not getting closer.`)
  if (p.notes) parts.push(`Also: ${p.notes.slice(0, 160)}`)
  const brief = parts.join(' ')
  return brief.length <= PERSONA_BRIEF_MAX ? brief : `${brief.slice(0, PERSONA_BRIEF_MAX - 1)}…`
}

// ── The editor's draft ──────────────────────────────────────────────────────

/** What the editor holds while someone types: text fields as typed, numbers as numbers. */
export interface PersonaDraft {
  name: string
  preset: PersonaPresetId | null
  goal: string
  locale: string
  device: PersonaDevice
  expertise: PersonaExpertise
  accessibility: PersonaNeed[]
  patienceSteps: number
  costCapUsd: number
  notes: string
}

/** The server's `plain()`: runs of whitespace become one space, ends trimmed. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Needs in the server's order, each once (it sorts them the same way before it saves). */
export function sortNeeds(needs: readonly PersonaNeed[]): PersonaNeed[] {
  return [...new Set(needs)].sort((a, z) => PERSONA_NEEDS.indexOf(a) - PERSONA_NEEDS.indexOf(z))
}

export function draftFrom(p: PersonaFields): PersonaDraft {
  return {
    name: p.name,
    preset: p.preset,
    goal: p.goal ?? '',
    locale: p.locale,
    device: p.device,
    expertise: p.expertise,
    accessibility: sortNeeds(p.accessibility),
    patienceSteps: p.patienceSteps,
    costCapUsd: p.costCapUsd,
    notes: p.notes ?? '',
  }
}

/** The fields as the server will save them: whitespace collapsed, needs in order, empty text as null. */
export function draftFields(d: PersonaDraft): PersonaFields {
  const goal = collapse(d.goal)
  const notes = collapse(d.notes)
  return {
    name: collapse(d.name),
    preset: d.preset,
    goal: goal || null,
    locale: d.locale.trim(),
    device: d.device,
    expertise: d.expertise,
    accessibility: sortNeeds(d.accessibility),
    patienceSteps: d.patienceSteps,
    costCapUsd: Math.round(d.costCapUsd * 100) / 100,
    notes: notes || null,
  }
}

/** The brief this draft would be saved with (the live preview). */
export function draftBrief(d: PersonaDraft): string {
  const f = draftFields(d)
  return personaBrief({ ...f, name: f.name || 'Unnamed visitor' })
}

type PersonaDraftErrors = Partial<Record<'name' | 'goal' | 'locale' | 'patienceSteps' | 'costCapUsd' | 'notes', string>>

/** The server's checks, in its words, so Save is off before it would be refused. */
export function draftErrors(d: PersonaDraft): PersonaDraftErrors {
  const out: PersonaDraftErrors = {}
  const name = collapse(d.name)
  if (!name || name.length > PERSONA_NAME_MAX) out.name = `Give the persona a name (up to ${PERSONA_NAME_MAX} characters).`
  const goal = collapse(d.goal)
  if (goal && (goal.length > PERSONA_GOAL_MAX || goal.startsWith('-'))) out.goal = `The goal is a few plain words (up to ${PERSONA_GOAL_MAX} characters).`
  const locale = d.locale.trim()
  if (locale.length > 35 || !PERSONA_LOCALE_RE.test(locale)) out.locale = 'The language is a code like en-US or ja-JP.'
  if (!Number.isInteger(d.patienceSteps) || d.patienceSteps < PERSONA_STEPS_MIN || d.patienceSteps > PERSONA_STEPS_MAX) {
    out.patienceSteps = `Patience is a whole number of steps from ${PERSONA_STEPS_MIN} to ${PERSONA_STEPS_MAX}.`
  }
  if (!Number.isFinite(d.costCapUsd) || d.costCapUsd < PERSONA_COST_CAP_MIN_USD || d.costCapUsd > PERSONA_COST_CAP_MAX_USD) {
    out.costCapUsd = `The cost cap is from $${PERSONA_COST_CAP_MIN_USD.toFixed(2)} to $${PERSONA_COST_CAP_MAX_USD} a test.`
  }
  const notes = collapse(d.notes)
  if (notes.length > PERSONA_NOTES_MAX) out.notes = `Notes are plain text, up to ${PERSONA_NOTES_MAX} characters.`
  return out
}

/** The POST body for a new persona: exactly the ten fields, nothing else. */
export function createBody(d: PersonaDraft): PersonaFields {
  return draftFields(d)
}

/** The PATCH body: only the fields that changed, or null when nothing did. */
export function patchBody(original: PersonaFields, d: PersonaDraft): Partial<PersonaFields> | null {
  const next = draftFields(d)
  const out: Partial<PersonaFields> = {}
  if (next.name !== original.name) out.name = next.name
  if ((next.goal ?? null) !== (original.goal ?? null)) out.goal = next.goal
  if (next.locale !== original.locale) out.locale = next.locale
  if (next.device !== original.device) out.device = next.device
  if (next.expertise !== original.expertise) out.expertise = next.expertise
  if (next.accessibility.join(',') !== sortNeeds(original.accessibility).join(',')) out.accessibility = next.accessibility
  if (next.patienceSteps !== original.patienceSteps) out.patienceSteps = next.patienceSteps
  if (next.costCapUsd !== original.costCapUsd) out.costCapUsd = next.costCapUsd
  if ((next.notes ?? null) !== (original.notes ?? null)) out.notes = next.notes
  return Object.keys(out).length ? out : null
}

// ── Words and pictures ──────────────────────────────────────────────────────

export const DEVICE_LABEL: Record<PersonaDevice, string> = { desktop: 'Laptop', tablet: 'Tablet', mobile: 'Phone' }
export const EXPERTISE_LABEL: Record<PersonaExpertise, string> = { new: 'New to apps like this', casual: 'Casual', power: 'Power user' }
export const EXPERTISE_SHORT: Record<PersonaExpertise, string> = { new: 'New', casual: 'Casual', power: 'Power' }
export const NEED_LABEL: Record<PersonaNeed, string> = {
  screen_reader: 'Screen reader',
  low_vision: 'Low vision',
  keyboard_only: 'Keyboard only',
  reduced_motion: 'Reduced motion',
  color_blind: 'Colour blind',
  motor: 'Hard to tap',
  plain_language: 'Plain words',
}

/** Languages the editor lists first; any BCP 47 code is accepted too. */
export const COMMON_LOCALES = ['en-US', 'ja-JP', 'zh-CN', 'ko-KR', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR'] as const

const VIEWPORT: Record<PersonaDevice, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
}

/** The browser window the visitor gets: its device's size, in CSS px at 150% zoom for low vision. */
export function personaViewport(p: Pick<PersonaFields, 'device' | 'accessibility'>): { width: number; height: number; zoom: number; touch: boolean; label: string } {
  const base = VIEWPORT[p.device]
  const zoomed = p.accessibility.includes('low_vision')
  const zoom = zoomed ? 1.5 : 1
  const width = Math.round(base.width / zoom)
  const height = Math.round(base.height / zoom)
  const touch = p.device !== 'desktop'
  const size = `${width}×${height}`
  const label = zoomed
    ? `${DEVICE_LABEL[p.device]} at 150% zoom, ${size} CSS px${touch ? ', touch' : ''}`
    : `${DEVICE_LABEL[p.device]}, ${size}${touch ? ', touch' : ''}`
  return { width, height, zoom, touch, label }
}

/** "$1", "$0.50": what one test may spend. */
export function formatUsd(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

const NEED_TRY: Partial<Record<PersonaNeed, string>> = {
  screen_reader: 'Knows only what a screen reader announces',
  keyboard_only: 'Moves only with Tab, Enter and Escape',
  reduced_motion: 'Is bothered by moving or flashing things',
  color_blind: 'Cannot tell red from green',
  motor: 'Misses small or close-together buttons',
  plain_language: 'Looks for plain words',
}

/** What this visitor will try, in short lines, for the editor's preview. */
export function personaTries(p: Pick<PersonaFields, 'device' | 'accessibility' | 'locale' | 'patienceSteps' | 'costCapUsd' | 'goal'>): string[] {
  const lang = p.locale.toLowerCase().startsWith('en') ? p.locale : `${p.locale} (${languageName(p.locale)})`
  const out = [personaViewport(p).label, `Browser language ${lang}`]
  for (const n of sortNeeds(p.accessibility)) {
    const line = NEED_TRY[n]
    if (line) out.push(line)
  }
  out.push(`Stops after ${p.patienceSteps} steps`)
  out.push(`Spends at most ${formatUsd(p.costCapUsd)} of AI budget a test`)
  out.push(p.goal ? `Tries to ${p.goal.replace(/[.\s]+$/, '')}` : 'Tries the goal you type on the test page')
  return out
}

/** One or two letters for the avatar: the first letter of the first two words. */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = (w: string) => (Array.from(w)[0] ?? '').toLocaleUpperCase()
  return words.length === 1 ? first(words[0]!) : `${first(words[0]!)}${first(words[1]!)}`
}

/**
 * Avatar hues: none that means a state (red is a failure, amber a warning,
 * green a pass), so a persona's colour never reads as how its test went.
 */
/** @internal Exported for tests. */
export const AVATAR_ACCENTS = ['accent', 'info', 'lime', 'brand'] as const
export type AvatarAccent = (typeof AVATAR_ACCENTS)[number]

/** The same name always gets the same hue (FNV-1a over its UTF-16 units). */
export function avatarAccent(name: string): AvatarAccent {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return AVATAR_ACCENTS[h % AVATAR_ACCENTS.length]!
}

/** "Japanese visitor: phone, reads Japanese, screen reader". */
export function avatarLabel(p: Pick<PersonaFields, 'name' | 'device' | 'locale' | 'accessibility'>): string {
  const traits = [DEVICE_LABEL[p.device].toLowerCase()]
  if (!p.locale.toLowerCase().startsWith('en')) traits.push(`reads ${languageName(p.locale)}`)
  for (const n of sortNeeds(p.accessibility)) traits.push(NEED_LABEL[n].toLowerCase())
  return `${p.name || 'Unnamed visitor'}: ${traits.join(', ')}`
}

/** A finished test that could sign up and reached a measured time. */
function measured(r: PersonaRun): boolean {
  return r.status === 'done' && !r.dry_run && r.ttfv_seconds != null && Number.isFinite(r.ttfv_seconds)
}

/** Time to first value of the persona's finished tests, oldest first, for its sparkline. */
export function ttfvSeries(runs: readonly PersonaRun[]): number[] {
  return runs
    .filter(measured)
    .slice()
    .reverse()
    .map((r) => r.ttfv_seconds as number)
}

/** The persona's last test in one line, and the state mark it shows with. */
export function lastResult(runs: readonly PersonaRun[]): { status: 'passed' | 'failed' | 'running' | 'waiting' | 'idle'; text: string } {
  const newest = runs[0]
  if (!newest) return { status: 'idle', text: 'No tests yet' }
  if (newest.status === 'queued') return { status: 'waiting', text: 'Waiting for your computer' }
  if (newest.status === 'running') return { status: 'running', text: 'A test is running' }
  const last = runs.find((r) => r.status === 'done' && !r.dry_run) ?? runs.find((r) => r.status === 'done')
  if (!last) return newest.status === 'failed' ? { status: 'failed', text: 'The last test did not run' } : { status: 'idle', text: 'No finished test yet' }
  const sessions = last.counts?.sessions ?? 0
  const reached = last.reached ?? 0
  if (reached > 0) {
    const time = last.ttfv_seconds != null ? ` · ${formatSeconds(last.ttfv_seconds)} to first value` : ''
    return { status: 'passed', text: `Reached the goal ${reached} of ${sessions}${time}` }
  }
  if (last.dry_run) return { status: 'idle', text: 'Looked around only' }
  return { status: 'failed', text: 'Stalled' }
}

/** The month's AI budget in one line for the status block. */
export function budgetLine(b: PersonaBudget | null): string {
  if (!b) return 'Budget unknown: it could not be read just now.'
  if (b.monthlyUsd == null) return 'No monthly AI budget; each test is capped by its persona.'
  const held = b.heldUsd != null && b.heldUsd > 0 ? ` · ${formatUsd(Math.round(b.heldUsd * 100) / 100)} held by running tests` : ''
  return `This month: ${formatUsd(b.spentUsd)} of ${formatUsd(b.monthlyUsd)}${held}`
}
