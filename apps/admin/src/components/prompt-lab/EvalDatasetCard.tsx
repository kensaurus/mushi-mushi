import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, EmptyState, RelativeTime } from '../ui'
import { StatusGlyph, type SignalTone } from '../signal/StatusGlyph'
import type { DatasetSample } from './types'

/** @internal Exported for tests. A report severity as a glyph tone (colour plus shape). */
export function severityGlyph(severity: string | null): { tone: SignalTone; word: string } {
  const s = (severity ?? '').toLowerCase()
  if (s === 'critical') return { tone: 'danger', word: 'Critical' }
  if (s === 'high') return { tone: 'danger', word: 'High' }
  if (s === 'medium') return { tone: 'warn', word: 'Medium' }
  if (s === 'low') return { tone: 'info', word: 'Low' }
  return { tone: 'off', word: 'No severity' }
}

/** @internal Exported for tests. A report's title: its first non-empty line, without JSON or markdown noise. */
export function sampleTitle(description: string | null | undefined): string {
  const lines = (description ?? '').split(/\r?\n/).map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
  const first = lines.find((l) => l && !/^[{[]/.test(l))
  return first || '(no description)'
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
              const sev = severityGlyph(s.severity)
              return (
                <li key={s.id} className="py-1.5 first:pt-0" data-testid="eval-dataset-row">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0" title={sev.word}>
                      <StatusGlyph tone={sev.tone} label={sev.word} />
                    </span>
                    <Link
                      to={`/reports/${s.id}`}
                      title={s.description ?? undefined}
                      className="min-w-0 flex-1 truncate text-fg hover:text-fg underline-offset-2 hover:underline"
                    >
                      {sampleTitle(s.description)}
                    </Link>
                    <RelativeTime value={s.created_at} className="shrink-0 text-2xs text-fg-faint" />
                    <button
                      type="button"
                      className="shrink-0 text-2xs text-accent-foreground underline underline-offset-2 hover:text-accent"
                      aria-expanded={expanded}
                      onClick={() => toggle(s.id)}
                    >
                      {expanded ? 'Hide' : 'Details'}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-1 space-y-1 pl-5" data-testid="eval-dataset-details">
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        {s.category && <Badge tone="neutral" title="Category">{s.category}</Badge>}
                        {s.component && <Badge tone="neutral" title="Area">{s.component}</Badge>}
                      </div>
                      <p className="whitespace-pre-line break-words text-2xs text-fg-secondary" data-testid="eval-dataset-body">
                        {text}
                      </p>
                    </div>
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
