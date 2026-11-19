import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, EmptyState, RelativeTime, type BadgeTone } from '../ui'
import type { DatasetSample } from './types'

function severityTone(severity: string): BadgeTone {
  const s = severity.toLowerCase()
  if (s === 'critical' || s === 'high') return 'dangerSubtle'
  if (s === 'medium') return 'warnSubtle'
  return 'neutral'
}

interface EvalDatasetCardProps {
  total: number
  labelled: number
  recentSamples: DatasetSample[]
}

/**
 * One line per report, the body on "Show" (2026-11-19: every row printed the whole report body,
 * about 16 lines at 1440 and 60 at 390). The old `block line-clamp-2` pair never clamped:
 * `block` overrides the `-webkit-box` display that line-clamp needs.
 */
export function EvalDatasetCard({ labelled, recentSamples }: EvalDatasetCardProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    // The Eval dataset tile links here (?tab=dataset).
    <section id="prompt-lab-dataset" className="scroll-mt-4">
      <Card elevated className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-fg-secondary">
            Eval dataset · recent classified reports
          </h3>
          <span className="text-2xs text-fg-faint tabular-nums">
            {labelled.toLocaleString()} labelled
          </span>
        </div>
        {recentSamples.length === 0 ? (
          <EmptyState
            title="No labelled reports yet"
            description="Once Mushi Mushi diagnoses reports, they appear here as the eval dataset for your next prompt experiment."
          />
        ) : (
          <ul className="text-xs divide-y divide-edge-subtle" data-testid="eval-dataset-rows">
            {recentSamples.map((s) => {
              const expanded = open.has(s.id)
              const text = s.description || '(no description)'
              return (
                <li key={s.id} className="py-1.5 first:pt-0" data-testid="eval-dataset-row">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      to={`/reports/${s.id}`}
                      title={s.description ?? undefined}
                      className="min-w-0 flex-1 truncate text-fg-secondary hover:text-fg underline-offset-2 hover:underline"
                    >
                      {text}
                    </Link>
                    <button
                      type="button"
                      className="shrink-0 text-2xs text-accent-foreground underline underline-offset-2 hover:text-accent"
                      aria-expanded={expanded}
                      onClick={() => toggle(s.id)}
                    >
                      {expanded ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
                    {s.category && <Badge tone="neutral" title="Category">{s.category}</Badge>}
                    {s.severity && <Badge tone={severityTone(s.severity)} title="Severity">{s.severity}</Badge>}
                    {s.component && <Badge tone="neutral" title="Component">{s.component}</Badge>}
                    <RelativeTime value={s.created_at} className="ml-auto text-2xs text-fg-faint shrink-0" />
                  </div>
                  {expanded && (
                    <p className="mt-1 whitespace-pre-line break-words text-2xs text-fg-secondary" data-testid="eval-dataset-body">
                      {text}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </section>
  )
}
