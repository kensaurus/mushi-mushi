/**
 * FILE: apps/admin/src/components/journeys/JourneyFindings.tsx
 * PURPOSE: The Journey optimizer's findings list (filter by kind or by the
 *          page selected on the map, copy one or all as agent prompts) and
 *          the most common paths.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Badge, CopyButton, Section } from '../ui'
import { KIND_LABEL, KIND_SOURCE, SEVERITY_LABEL, SEVERITY_TONE, allFindingsPrompt, type JourneyFinding } from '../../lib/journeys'

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
      className={`rounded-full border px-2 py-0.5 text-2xs ${active ? 'border-brand bg-brand/10 text-fg' : 'border-edge-subtle text-fg-muted hover:border-brand/40'}`}
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

export function FlowsSection({ flows }: { flows: Array<{ pages: string[]; sessions: number }> }) {
  return (
    <Section title="Most common paths">
      {flows.length === 0 ? (
        <p className="text-xs text-fg-muted">Paths appear once at least two visits take the same route.</p>
      ) : (
        <ol className="space-y-2">
          {flows.map((f) => (
            <li key={f.pages.join('>')} className="text-xs">
              <div className="flex flex-wrap items-center gap-1 font-mono text-2xs text-fg">
                {f.pages.map((p, i) => (
                  <span key={`${p}-${i}`} className="flex items-center gap-1">
                    {i > 0 && <span aria-hidden className="text-fg-faint">→</span>}
                    <span className="rounded-sm bg-surface-overlay px-1">{p}</span>
                  </span>
                ))}
              </div>
              <span className="text-2xs text-fg-faint">{f.sessions} visits</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}
