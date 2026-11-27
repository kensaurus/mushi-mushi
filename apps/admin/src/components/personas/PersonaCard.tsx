/**
 * FILE: apps/admin/src/components/personas/PersonaCard.tsx
 * PURPOSE: One persona in the studio (ADR 0073): its picture, who it is in
 *          chips, how patient it is and what a test may spend, and its history:
 *          a sparkline of time to first value across its finished tests and how
 *          the last one went. One link starts a first-time user test as it.
 */

import { Badge, Btn, Card, Sparkline } from '../ui'
import { StatusMark } from '../signal/StatusMark'
import { formatSeconds } from '../../lib/freshEyes'
import {
  DEVICE_LABEL,
  EXPERTISE_SHORT,
  formatUsd,
  lastResult,
  NEED_LABEL,
  sortNeeds,
  ttfvSeries,
  type Persona,
  type PersonaFields,
} from '../../lib/personas'
import { PersonaAvatar } from './PersonaAvatar'

/** Device, language, how much they know and each need, as chips. */
export function PersonaChips({ persona, className = '' }: { persona: Pick<PersonaFields, 'device' | 'locale' | 'expertise' | 'accessibility'>; className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-1 ${className}`} aria-label="Who they are">
      <li>
        <Badge tone="neutral">{DEVICE_LABEL[persona.device]}</Badge>
      </li>
      <li>
        <Badge tone="neutral">{persona.locale}</Badge>
      </li>
      <li>
        <Badge tone="neutral">{EXPERTISE_SHORT[persona.expertise]}</Badge>
      </li>
      {sortNeeds(persona.accessibility).map((n) => (
        <li key={n}>
          <Badge tone="accent">{NEED_LABEL[n]}</Badge>
        </li>
      ))}
    </ul>
  )
}

export function PersonaCard({
  persona,
  canEdit,
  editing,
  onEdit,
  onDelete,
}: {
  persona: Persona
  canEdit: boolean
  editing: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const runs = persona.runs ?? []
  const series = ttfvSeries(runs)
  const result = lastResult(runs)
  return (
    <Card className={`group ci-rise flex h-full flex-col gap-3 p-3 ${editing ? 'ring-2 ring-brand/50' : ''}`} data-testid="persona-card">
      <div className="flex items-start gap-3">
        <PersonaAvatar persona={persona} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-fg" title={persona.name}>
            {persona.name}
          </h3>
          <p className="line-clamp-2 text-2xs text-fg-secondary">{persona.goal ? `Came to ${persona.goal}` : 'Tries the goal you type on the test page'}</p>
          <PersonaChips persona={persona} className="mt-1.5" />
        </div>
      </div>

      <p className="text-2xs text-fg-secondary">
        Gives up after ~{persona.patienceSteps} steps · {formatUsd(persona.costCapUsd)} a test
      </p>

      <div className="flex min-w-0 items-center gap-2 rounded-sm bg-surface-overlay px-2 py-1.5" data-testid="persona-history">
        <StatusMark status={result.status} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-2xs text-fg" title={result.text}>
          {result.text}
        </span>
        {series.length > 0 && (
          <span className="shrink-0 text-accent-foreground" title={`Time to first value, oldest to newest: ${series.map((s) => formatSeconds(s)).join(', ')}`}>
            <Sparkline values={series} width={72} height={20} ariaLabel={`Time to first value over ${series.length} test${series.length === 1 ? '' : 's'}, latest ${formatSeconds(series[series.length - 1])}`} />
          </span>
        )}
      </div>

      <details className="group/brief text-2xs">
        <summary className="cursor-pointer rounded-xs text-fg-secondary hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">What the visitor reads</summary>
        <p className="mt-1 leading-relaxed text-fg-secondary">{persona.brief}</p>
      </details>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Btn size="sm" to={`/first-user-test?persona=${encodeURIComponent(persona.id)}`}>
          Test with this persona
        </Btn>
        {canEdit && (
          <>
            <Btn size="sm" variant="ghost" onClick={onEdit} aria-expanded={editing} aria-label={`Edit ${persona.name}`}>
              Edit
            </Btn>
            <Btn size="sm" variant="danger" onClick={onDelete} aria-label={`Delete ${persona.name}`}>
              Delete
            </Btn>
          </>
        )}
      </div>
    </Card>
  )
}
