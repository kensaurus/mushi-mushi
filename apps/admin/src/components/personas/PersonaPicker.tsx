/**
 * FILE: apps/admin/src/components/personas/PersonaPicker.tsx
 * PURPOSE: Who the first-time user test plays (ADR 0073): a row of picture
 *          cards, a plain first-time visitor first, then each of the app's
 *          personas. One is chosen at a time (a radio group, like
 *          SegmentedControl). Under it, the chosen persona's brief.
 */

import { Link } from 'react-router-dom'
import { SELECTED_TONE, SELECTED_TONE_IDLE } from '../../lib/chipTone'
import { DEVICE_LABEL, formatUsd, personaBrief } from '../../lib/personas'
import type { FreshEyesPersona } from '../../lib/freshEyes'
import { PersonaAvatar, PlainVisitorAvatar } from './PersonaAvatar'

const PLAIN = '__plain__'

export function PersonaPicker({ personas, value, onChange }: { personas: readonly FreshEyesPersona[]; value: string | null; onChange: (id: string | null) => void }) {
  const chosen = personas.find((p) => p.id === value) ?? null
  const options: Array<{ id: string; persona: FreshEyesPersona | null }> = [{ id: PLAIN, persona: null }, ...personas.map((p) => ({ id: p.id, persona: p }))]
  return (
    <div className="flex flex-col gap-1.5" data-testid="persona-picker">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span id="persona-picker-label" className="text-2xs font-medium text-fg-muted">
          Who visits
        </span>
        <Link to="/personas" className="text-2xs text-brand underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
          {personas.length ? 'Manage personas' : 'Add personas'}
        </Link>
      </div>
      <div role="radiogroup" aria-labelledby="persona-picker-label" className="flex gap-1.5 overflow-x-auto pb-0.5">
        {options.map(({ id, persona }) => {
          const on = persona ? persona.id === value : chosen == null
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(persona ? persona.id : null)}
              className={`group flex min-h-8 shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 text-left text-2xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.97] ${on ? SELECTED_TONE : `border ${SELECTED_TONE_IDLE}`}`}
              data-persona={persona?.id ?? 'plain'}
            >
              {persona ? <PersonaAvatar persona={persona} size="sm" decorative /> : <PlainVisitorAvatar size="sm" />}
              <span className="max-w-40 truncate">{persona ? persona.name : 'Plain first-time visitor'}</span>
              {persona && <span className="sr-only">, {DEVICE_LABEL[persona.device].toLowerCase()}</span>}
            </button>
          )
        })}
      </div>
      {chosen ? (
        <p className="max-w-prose text-2xs leading-relaxed text-fg-secondary" data-testid="persona-picker-brief">
          {personaBrief(chosen)} <span className="text-fg-muted">Gives up after ~{chosen.patienceSteps} steps · at most {formatUsd(chosen.costCapUsd)} of AI budget.</span>
        </p>
      ) : (
        <p className="text-2xs text-fg-muted">Someone who has never seen the app before.</p>
      )}
    </div>
  )
}
