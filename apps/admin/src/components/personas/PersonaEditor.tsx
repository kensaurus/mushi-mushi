/**
 * FILE: apps/admin/src/components/personas/PersonaEditor.tsx
 * PURPOSE: Add or change a persona (ADR 0073), with a live preview beside the
 *          form: the persona's picture, the browser window its visitor gets
 *          (drawn to scale), what that visitor will try, and the exact brief
 *          the visitor model reads, which the server computes the same way.
 *
 * Writes: POST /v1/admin/projects/:pid/personas (the ten fields),
 *         PATCH …/personas/:id (only the fields that changed).
 */

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Btn, Card, Input, SegmentedControl, SelectField, Textarea } from '../ui'
import { SELECTED_TONE, SELECTED_TONE_IDLE } from '../../lib/chipTone'
import { apiFetchMutate } from '../../lib/supabase'
import {
  COMMON_LOCALES,
  createBody,
  DEVICE_LABEL,
  draftBrief,
  draftErrors,
  draftFields,
  draftFrom,
  EXPERTISE_LABEL,
  languageName,
  NEED_LABEL,
  patchBody,
  PERSONA_BRIEF_MAX,
  PERSONA_COST_CAP_MAX_USD,
  PERSONA_COST_CAP_MIN_USD,
  PERSONA_EXPERTISE,
  PERSONA_NEEDS,
  PERSONA_STEPS_MAX,
  PERSONA_STEPS_MIN,
  personaTries,
  personaViewport,
  type Persona,
  type PersonaDevice,
  type PersonaDraft,
  type PersonaExpertise,
  type PersonaFields,
  type PersonaNeed,
} from '../../lib/personas'
import { PersonaAvatar } from './PersonaAvatar'
import { PersonaChips } from './PersonaCard'

const OTHER_LOCALE = 'other'
/** Smallest screen last, as people think of them. */
const DEVICE_ORDER: readonly PersonaDevice[] = ['desktop', 'tablet', 'mobile']

type Touched = Partial<Record<'name' | 'goal' | 'locale' | 'patienceSteps' | 'costCapUsd' | 'notes', boolean>>

export function PersonaEditor({
  projectId,
  start,
  persona,
  onSaved,
  onCancel,
}: {
  projectId: string
  /** The fields the form opens with: a preset's for a new persona, the persona's own when editing. */
  start: PersonaFields
  /** The persona being changed; absent for a new one. */
  persona?: Persona
  onSaved: (name: string) => void
  onCancel: () => void
}) {
  const uid = useId()
  const fieldId = (name: string) => `persona-${persona?.id ?? 'new'}-${name}-${uid}`
  const [draft, setDraft] = useState<PersonaDraft>(() => draftFrom(start))
  const [costText, setCostText] = useState(() => String(start.costCapUsd))
  const [customLocale, setCustomLocale] = useState(() => !(COMMON_LOCALES as readonly string[]).includes(start.locale))
  const [touched, setTouched] = useState<Touched>({})
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  // The editor opens above the cards: put the keyboard where the typing starts.
  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true })
  }, [])

  const working: PersonaDraft = { ...draft, costCapUsd: costText.trim() === '' ? Number.NaN : Number(costText) }
  const errors = draftErrors(working)
  const shown = (k: keyof Touched) => (submitted || touched[k] ? errors[k] : undefined)
  const change = persona ? patchBody(persona, working) : null
  const unchanged = persona != null && change == null
  const set = <K extends keyof PersonaDraft>(key: K, value: PersonaDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const touch = (k: keyof Touched) => () => setTouched((t) => ({ ...t, [k]: true }))

  async function save(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    setError(null)
    if (Object.keys(errors).length > 0 || unchanged) return
    setBusy(true)
    const path = `/v1/admin/projects/${projectId}/personas${persona ? `/${persona.id}` : ''}`
    const body = persona ? change : createBody(working)
    const res = await apiFetchMutate<{ persona: Persona }>(path, { method: persona ? 'PATCH' : 'POST', body: JSON.stringify(body) })
    setBusy(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'It was not saved. Try again in a minute.')
      return
    }
    onSaved(res.data?.persona.name ?? draftFields(working).name)
  }

  const localeValue = customLocale ? OTHER_LOCALE : draft.locale

  return (
    <Card className="ci-rise flex flex-col gap-3 p-3" data-testid="persona-editor">
      <h2 className="text-sm font-semibold text-fg">{persona ? `Edit ${persona.name}` : 'New persona'}</h2>
      <div className="@container/persona-editor">
        <div className="grid gap-4 @3xl/persona-editor:grid-cols-5">
          <form className="flex min-w-0 flex-col gap-3 @3xl/persona-editor:col-span-3" onSubmit={save} noValidate aria-label={persona ? `Edit ${persona.name}` : 'New persona'}>
            <div className="grid gap-3 @lg/persona-editor:grid-cols-2">
              <Input
                id={fieldId('name')}
                label="Name"
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                onBlur={touch('name')}
                maxLength={60}
                placeholder="e.g. Busy parent on a phone"
                error={shown('name')}
                ref={nameRef}
              />
              <Input
                id={fieldId('goal')}
                label="What they came to do (optional)"
                value={draft.goal}
                onChange={(e) => set('goal', e.target.value)}
                onBlur={touch('goal')}
                maxLength={300}
                placeholder="sign up and add a first photo"
                error={shown('goal')}
              />
              <div className="flex flex-col gap-2">
                <SelectField
                  id={fieldId('locale-choice')}
                  label="Language they read"
                  value={localeValue}
                  onChange={(e) => {
                    if (e.target.value === OTHER_LOCALE) {
                      setCustomLocale(true)
                    } else {
                      setCustomLocale(false)
                      set('locale', e.target.value)
                    }
                  }}
                >
                  {COMMON_LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {languageName(l)} ({l})
                    </option>
                  ))}
                  <option value={OTHER_LOCALE}>Another language…</option>
                </SelectField>
                {customLocale && (
                  <Input
                    id={fieldId('locale')}
                    label="Language code"
                    value={draft.locale}
                    onChange={(e) => set('locale', e.target.value)}
                    onBlur={touch('locale')}
                    maxLength={35}
                    placeholder="e.g. it-IT"
                    spellCheck={false}
                    autoCapitalize="off"
                    error={shown('locale')}
                  />
                )}
              </div>
              <Input
                id={fieldId('cost')}
                label="Most a test may spend (USD)"
                type="number"
                inputMode="decimal"
                min={PERSONA_COST_CAP_MIN_USD}
                max={PERSONA_COST_CAP_MAX_USD}
                step={0.05}
                value={costText}
                onChange={(e) => setCostText(e.target.value)}
                onBlur={touch('costCapUsd')}
                error={shown('costCapUsd')}
              />
            </div>

            <ChoiceRow label="Device">
              <SegmentedControl<PersonaDevice>
                size="sm"
                ariaLabel="Device"
                value={draft.device}
                options={DEVICE_ORDER.map((d) => ({ id: d, label: DEVICE_LABEL[d] }))}
                onChange={(v) => set('device', v)}
              />
            </ChoiceRow>
            <ChoiceRow label="How well they know apps like this">
              <SegmentedControl<PersonaExpertise>
                size="sm"
                wrap
                ariaLabel="How well they know apps like this"
                value={draft.expertise}
                options={PERSONA_EXPERTISE.map((x) => ({ id: x, label: EXPERTISE_LABEL[x] }))}
                onChange={(v) => set('expertise', v)}
              />
            </ChoiceRow>
            <ChoiceRow label="What they need">
              <NeedToggles value={draft.accessibility} onChange={(v) => set('accessibility', v)} />
            </ChoiceRow>

            <div className="flex flex-col gap-1">
              <label htmlFor={fieldId('patience')} className="flex items-center justify-between text-xs font-medium text-fg-muted">
                <span>Patience</span>
                <span className="font-mono text-fg tabular-nums">gives up after ~{draft.patienceSteps} steps</span>
              </label>
              <input
                id={fieldId('patience')}
                type="range"
                min={PERSONA_STEPS_MIN}
                max={PERSONA_STEPS_MAX}
                step={1}
                value={draft.patienceSteps}
                onChange={(e) => set('patienceSteps', Number(e.target.value))}
                aria-valuetext={`${draft.patienceSteps} steps`}
                aria-invalid={shown('patienceSteps') ? true : undefined}
                aria-describedby={shown('patienceSteps') ? fieldId('patience-error') : undefined}
                className="w-full cursor-pointer accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              />
              <span className="flex justify-between text-2xs text-fg-muted" aria-hidden="true">
                <span>{PERSONA_STEPS_MIN}: leaves fast</span>
                <span>{PERSONA_STEPS_MAX}: very patient</span>
              </span>
              {shown('patienceSteps') && (
                <p id={fieldId('patience-error')} className="text-2xs text-danger">
                  {shown('patienceSteps')}
                </p>
              )}
            </div>

            <Textarea
              id={fieldId('notes')}
              label="Notes for the visitor (optional)"
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              onBlur={touch('notes')}
              maxLength={500}
              rows={2}
              placeholder="e.g. Has used a competitor before and expects its words."
              error={shown('notes')}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Btn type="submit" size="sm" loading={busy} disabled={unchanged}>
                {persona ? 'Save changes' : 'Add persona'}
              </Btn>
              <Btn type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
                Cancel
              </Btn>
              {unchanged && <span className="text-2xs text-fg-muted">Nothing changed yet.</span>}
              {error && (
                <span role="alert" className="text-2xs text-danger">
                  {error}
                </span>
              )}
            </div>
          </form>

          <PersonaPreview draft={working} />
        </div>
      </div>
    </Card>
  )
}

function ChoiceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  )
}

/** Needs as toggle chips: several at once, each says whether it is on. */
function NeedToggles({ value, onChange }: { value: readonly PersonaNeed[]; onChange: (next: PersonaNeed[]) => void }) {
  return (
    <div role="group" aria-label="What they need" className="flex flex-wrap gap-1.5">
      {PERSONA_NEEDS.map((n) => {
        const on = value.includes(n)
        return (
          <button
            key={n}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== n) : [...value, n])}
            className={`min-h-6 rounded-sm px-2 py-0.5 text-2xs font-medium pointer-coarse:min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.97] ${on ? SELECTED_TONE : `border ${SELECTED_TONE_IDLE}`}`}
          >
            {on && <span aria-hidden="true">✓ </span>}
            {NEED_LABEL[n]}
          </button>
        )
      })}
    </div>
  )
}

/** The browser window the visitor gets, drawn to scale in a 132 × 96 box. */
function ViewportSketch({ device, accessibility }: Pick<PersonaFields, 'device' | 'accessibility'>) {
  const v = personaViewport({ device, accessibility })
  const scale = Math.min(124 / v.width, 88 / v.height)
  const w = Math.round(v.width * scale)
  const h = Math.round(v.height * scale)
  const x = (132 - w) / 2
  const y = (96 - h) / 2
  const r = device === 'desktop' ? 3 : 7
  return (
    <svg viewBox="0 0 132 96" width={132} height={96} role="img" aria-label={`Browser window: ${v.label}`} className="shrink-0 text-fg-secondary">
      <rect x={x} y={y} width={w} height={h} rx={r} className="fill-surface-overlay" stroke="currentColor" strokeWidth="1.5" />
      {/* A page's first lines, at the zoom the visitor reads at. */}
      {[0, 1, 2].map((i) => (
        <rect key={i} x={x + 6} y={y + 8 + i * 8 * v.zoom} width={Math.max(8, (w - 12) * (i === 2 ? 0.5 : 0.85))} height={3 * v.zoom} rx={1.5} fill="currentColor" opacity={0.35} />
      ))}
      {device === 'desktop' && <path d={`M${x - 6} ${y + h + 3}H${x + w + 6}`} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  )
}

function PersonaPreview({ draft }: { draft: PersonaDraft }) {
  const fields = draftFields(draft)
  const named = { ...fields, name: fields.name || 'Unnamed visitor' }
  const cost = Number.isFinite(fields.costCapUsd) ? fields.costCapUsd : 0
  const tries = personaTries({ ...named, costCapUsd: cost })
  const brief = draftBrief(draft)
  return (
    <aside aria-label="Live preview" className="flex min-w-0 flex-col gap-3 rounded-md bg-surface-overlay p-3 @3xl/persona-editor:col-span-2" data-testid="persona-preview">
      <p className="text-2xs font-semibold text-fg-muted">Live preview</p>
      <div className="group flex items-center gap-3">
        <PersonaAvatar persona={named} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{named.name}</p>
          <PersonaChips persona={named} className="mt-1" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ViewportSketch device={fields.device} accessibility={fields.accessibility} />
        <p className="text-2xs text-fg-secondary">{personaViewport(fields).label}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-fg">What this visitor will try</p>
        <ul className="mt-1 flex flex-col gap-0.5 text-2xs text-fg-secondary" data-testid="persona-tries">
          {tries.map((t) => (
            <li key={t} className="flex items-start gap-1.5">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fg-muted" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="flex items-baseline justify-between gap-2 text-xs font-semibold text-fg">
          <span>What the visitor model reads</span>
          <span className="font-mono text-2xs font-normal text-fg-muted tabular-nums">
            {brief.length}/{PERSONA_BRIEF_MAX}
          </span>
        </p>
        <blockquote className="mt-1 border-l-2 border-edge pl-2 text-2xs leading-relaxed text-fg-secondary" data-testid="persona-brief">
          {brief}
        </blockquote>
      </div>
    </aside>
  )
}
