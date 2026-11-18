/**
 * FILE: apps/admin/src/components/journeys/JourneyFindings.tsx
 * PURPOSE: The Journey optimizer's findings list (filter by kind or by the
 *          page selected on the map, copy one or all as agent prompts) and
 *          the most common paths, ranked with bars.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Badge, CopyButton, Section } from '../ui'
import { KIND_LABEL, KIND_SOURCE, SEVERITY_LABEL, SEVERITY_TONE, allFindingsPrompt, percent, rankedPaths, type JourneyFinding } from '../../lib/journeys'
import { BarCell } from '../signal/BarCell'

export function FindingsSection({ findings, selected, onClear, appUrl }: { findings: JourneyFinding[]; selected: string | null; onClear: () => void; appUrl: string | null }) {
  const [kind, setKind] = useState<'all' | JourneyFinding['kind']>('all')
  const kinds = useMemo(() => [...new Set(findings.map((f) => f.kind))], [findings])
  const shown = findings.filter((f) => (kind === 'all' || f.kind === kind) && (!selected || f.pages.includes(selected)))
  const allPrompt = useMemo(() => allFindingsPrompt(shown, appUrl), [shown, appUrl])

  return (
    <Section
      title={selected ? `Problems on ${selected}` : 'What to improve'}
      action={shown.length > 1 ? <CopyButton value={allPrompt} label={`Copy all ${shown.length} as one prompt`} copiedLabel="Copied all" size="md" data-testid="journey-copy-all" /> : undefined}
    >
      {kinds.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filter by kind">
          <FilterChip active={kind === 'all'} onClick={() => setKind('all')}>All {findings.length}</FilterChip>
          {kinds.map((k) => (
            <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>
              {KIND_LABEL[k]} {findings.filter((f) => f.kind === k).length}
            </FilterChip>
          ))}
        </div>
      )}
      {selected && (
        <button type="button" onClick={onClear} className="mb-2 text-2xs text-brand underline">
          Show every page
        </button>
      )}
      {shown.length === 0 ? (
        <p className="text-xs text-fg-muted">{findings.length === 0 ? 'No problems found. Nice.' : 'Nothing here for this filter.'}</p>
      ) : (
        <ul className="space-y-2" data-testid="journey-findings">
          {shown.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-sm px-2 py-px text-2xs ${active ? 'border-brand bg-brand/10 text-fg' : 'border-edge-subtle text-fg-muted hover:border-brand/40'}`}
    >
      {children}
    </button>
  )
}

function FindingRow({ finding: f }: { finding: JourneyFinding }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-md border border-edge-subtle bg-surface-raised p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Badge>
        <Badge tone="neutral">{KIND_LABEL[f.kind]}</Badge>
        <span className="text-2xs text-fg-faint">from {KIND_SOURCE[f.kind] === 'visits' ? 'real visits' : KIND_SOURCE[f.kind] === 'scan' ? 'the site scan' : 'the live-site watch'}</span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-fg">{f.title}</p>
      <p className="mt-0.5 text-xs text-fg-secondary">{f.detail}</p>
      <p className="mt-1 text-xs text-fg">
        <span className="font-medium">What to change: </span>
        {f.suggestion}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CopyButton value={f.prompt} label="Copy prompt for your coding agent" copiedLabel="Prompt copied" size="md" />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-2xs text-fg-muted underline">
          {open ? 'Hide prompt' : 'Show prompt'}
        </button>
      </div>
      {open && <pre className="mushi-code-block mushi-code-body mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md px-3 py-2 text-2xs">{f.prompt}</pre>}
    </li>
  )
}

/**
 * The most common paths as a ranked list (owner, 2026-11-18): the flow map's
 * labels are too small to read at normal width, so the top paths also read as
 * text, most visits first, each with a bar on the busiest path's scale.
 */
export function FlowsSection({ flows, totalSessions }: { flows: Array<{ pages: string[]; sessions: number }>; totalSessions: number }) {
  const ranked = rankedPaths(flows, totalSessions)
  const top = ranked[0]?.sessions ?? 0
  return (
    <Section title="Top paths">
      {ranked.length === 0 ? (
        <p className="text-xs text-fg-secondary">Paths appear once at least two visits take the same route.</p>
      ) : (
        <ol className="space-y-1.5" aria-label="Most common paths, most visits first" data-testid="journey-top-paths">
          {ranked.map((f, i) => (
            <li
              key={f.pages.join('>')}
              // mushi-mushi-allowlist: rank number column / path column; the rank fits two digits
              className="ci-rise grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-1.5 gap-y-0.5"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className="sr-only">{`${f.pages.join(' then ')}: ${f.sessions} visits${f.share != null ? `, ${percent(f.share)} of all visits` : ''}`}</span>
              <span className="pt-0.5 text-right font-mono text-2xs font-bold text-fg-secondary tabular-nums" aria-hidden="true">
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-2xs text-fg" aria-hidden="true">
                {f.pages.map((p, j) => (
                  <span key={`${p}-${j}`} className="flex min-w-0 items-center gap-1">
                    {j > 0 && <span className="text-fg-secondary">→</span>}
                    <span className="max-w-40 truncate rounded-sm bg-surface-overlay px-1" title={p}>{p}</span>
                  </span>
                ))}
              </span>
              <span className="col-start-2 flex items-center gap-2" aria-hidden="true">
                <BarCell value={f.sessions} max={top} tone="heat" text={f.sessions} widthClass="w-24" />
                <span className="text-3xs text-fg-secondary">visits{f.share != null ? ` · ${percent(f.share)}` : ''}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}
