/**
 * FILE: apps/admin/src/components/recipe/RecipeElementViews.tsx
 * PURPOSE: Element-specific "What it is" views for the recipe side panel
 *          (gap #17), from the typed views GET /recipe/elements/:element adds:
 *            • Schema — the newest table list and what changed since the snapshot before
 *            • CI     — recent runs with estimated minutes
 *            • Deploy — expected (default-branch head) vs observed, per target
 *            • Env    — environment × variable matrix (names only)
 *          Never observed reads as "not observed" / "not checked", never as ok.
 *          Repo-sourced strings render as text; only https run links are links.
 */

import type { ReactNode } from 'react'
import { Badge, DataTableCell, DataTableHead, formatRelative, type BadgeTone } from '../ui'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { CiView, DeployTargetStatus, DeployView, EnvCell, EnvView, SchemaView } from '../../lib/recipeTypes'

export type ElementView =
  | { kind: 'schema'; view: SchemaView }
  | { kind: 'ci'; view: CiView }
  | { kind: 'deploy'; view: DeployView }
  | { kind: 'env'; view: EnvView }

const VIEW_KEYS = { schema: 'schemaView', ci: 'ciView', deploy: 'deployView', env: 'envView' } as const

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The typed view in an element's detail, when the server sent one; null otherwise. */
export function pickElementView(detail: Record<string, unknown> | null | undefined): ElementView | null {
  if (!detail) return null
  const s = detail[VIEW_KEYS.schema]
  if (isObj(s) && Array.isArray(s.tables)) return { kind: 'schema', view: s as unknown as SchemaView }
  const c = detail[VIEW_KEYS.ci]
  if (isObj(c) && Array.isArray(c.runs)) return { kind: 'ci', view: c as unknown as CiView }
  const d = detail[VIEW_KEYS.deploy]
  if (isObj(d) && Array.isArray(d.targets)) return { kind: 'deploy', view: d as unknown as DeployView }
  const e = detail[VIEW_KEYS.env]
  if (isObj(e) && Array.isArray(e.columns) && Array.isArray(e.rows)) return { kind: 'env', view: e as unknown as EnvView }
  return null
}

/** The rest of the detail, for the generic "More detail" list. */
export function detailWithoutView(detail: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.values(VIEW_KEYS) as string[]
  return Object.fromEntries(Object.entries(detail).filter(([k]) => !keys.includes(k)))
}

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : '—')
const when = (iso: string | null) => (iso ? formatRelative(iso) : '—')
const safeUrl = (u: string | null) => (u && /^https:\/\//i.test(u) ? u : null)

function TableShell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded-sm border border-edge-subtle/60">
      <table className="w-full text-xs" aria-label={label}>
        {children}
      </table>
    </div>
  )
}

// ── schema ───────────────────────────────────────────────────────────────────

function SchemaPanel({ view }: { view: SchemaView }) {
  if (!view.source) {
    return <p className="text-xs text-fg-secondary">No schema snapshot yet. Link the Supabase project; the daily drift scan reads the table list.</p>
  }
  const { diff } = view
  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-secondary">
        <span className="font-medium text-fg tabular-nums">{view.totalTables.toLocaleString()}</span> table{view.totalTables === 1 ? '' : 's'}, read{' '}
        {when(view.capturedAt)} by the {view.source === 'drift_scanner' ? 'schema drift scan' : 'Supabase connection'}.
      </p>
      {diff ? (
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-fg-secondary">Since {when(diff.previousCapturedAt)}</h3>
          {diff.added.length + diff.removed.length + diff.changed.length === 0 ? (
            <p className="text-xs text-fg-muted">No table changed.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {diff.added.map((t) => (
                <li key={`a-${t}`} className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="okSubtle">added</Badge>
                  <span className="font-mono text-fg wrap-break-word">{t}</span>
                </li>
              ))}
              {diff.removed.map((t) => (
                <li key={`r-${t}`} className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="dangerSubtle">removed</Badge>
                  <span className="font-mono text-fg wrap-break-word">{t}</span>
                </li>
              ))}
              {diff.changed.map((c) => (
                <li key={`c-${c.name}`} className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="warnSubtle">changed</Badge>
                  <span className="font-mono text-fg wrap-break-word">{c.name}</span>
                  <span className="text-fg-secondary">
                    {[
                      c.addedColumns.length ? `+${c.addedColumns.join(', ')}` : null,
                      c.removedColumns.length ? `−${c.removedColumns.join(', ')}` : null,
                      c.rls ? `RLS ${c.rls.from ? 'on' : 'off'} → ${c.rls.to ? 'on' : 'off'}` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-2xs text-fg-muted">Only one snapshot so far, so there is nothing to compare yet.</p>
      )}
      <TableShell label="Tables">
        <thead>
          <tr>
            <DataTableHead>Table</DataTableHead>
            <DataTableHead>RLS</DataTableHead>
            <DataTableHead>Columns</DataTableHead>
          </tr>
        </thead>
        <tbody>
          {view.tables.map((t) => (
            <tr key={`${t.schema ?? 'public'}.${t.name}`} className="border-t border-edge-subtle">
              <DataTableCell>
                <span className="font-mono wrap-break-word">{t.schema && t.schema !== 'public' ? `${t.schema}.` : ''}{t.name}</span>
              </DataTableCell>
              <DataTableCell>
                {t.rls === null ? <span className="text-fg-faint">—</span> : <Badge tone={t.rls ? 'okSubtle' : 'dangerSubtle'}>{t.rls ? 'on' : 'off'}</Badge>}
              </DataTableCell>
              <DataTableCell>
                <span className="tabular-nums">{t.columns ?? '—'}</span>
              </DataTableCell>
            </tr>
          ))}
        </tbody>
      </TableShell>
      {view.totalTables > view.tables.length && (
        <p className="text-2xs text-fg-muted">Showing {view.tables.length.toLocaleString()} of {view.totalTables.toLocaleString()} tables.</p>
      )}
    </div>
  )
}

// ── ci ───────────────────────────────────────────────────────────────────────

function conclusionTone(c: string | null, status: string | null): BadgeTone {
  if (c === 'success') return 'okSubtle'
  if (c === 'failure' || c === 'timed_out' || c === 'startup_failure') return 'dangerSubtle'
  if (!c && status !== 'completed') return 'infoSubtle'
  return 'neutral'
}

function CiPanel({ view }: { view: CiView }) {
  if (view.runs.length === 0) {
    return <p className="text-xs text-fg-secondary">No workflow runs recorded yet. They appear after the GitHub connection's first daily read.</p>
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-secondary">
        {view.estMinutesTotal !== null ? (
          <>
            About <span className="font-medium text-fg tabular-nums">{view.estMinutesTotal.toLocaleString()}</span> billable minutes across{' '}
            {view.estimatedRuns} estimated run{view.estimatedRuns === 1 ? '' : 's'}.
          </>
        ) : (
          'No run has a minutes estimate yet.'
        )}
      </p>
      <TableShell label="Recent workflow runs">
        <thead>
          <tr>
            <DataTableHead>Run</DataTableHead>
            <DataTableHead>Result</DataTableHead>
            <DataTableHead>Started</DataTableHead>
            <DataTableHead>Est. min</DataTableHead>
          </tr>
        </thead>
        <tbody>
          {view.runs.map((r) => {
            const href = safeUrl(r.url)
            const label = `${r.name ?? 'Run'}${r.branch ? ` · ${r.branch}` : ''}`
            return (
              <tr key={r.runId} className="border-t border-edge-subtle align-top">
                <DataTableCell>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className={`${LINK_ACCENT} wrap-break-word`}>
                      {label}
                    </a>
                  ) : (
                    <span className="wrap-break-word">{label}</span>
                  )}
                  <span className="block font-mono text-2xs text-fg-faint">{short(r.headSha)}</span>
                </DataTableCell>
                <DataTableCell>
                  <Badge tone={conclusionTone(r.conclusion, r.status)}>{r.conclusion ?? r.status ?? 'unknown'}</Badge>
                </DataTableCell>
                <DataTableCell>{when(r.startedAt)}</DataTableCell>
                <DataTableCell>
                  <span className="tabular-nums">{r.estMinutes ?? '—'}</span>
                </DataTableCell>
              </tr>
            )
          })}
        </tbody>
      </TableShell>
      <p className="text-2xs text-fg-muted">{view.note}</p>
    </div>
  )
}

// ── deploy ───────────────────────────────────────────────────────────────────

const DEPLOY_STATUS: Record<DeployTargetStatus, { label: string; tone: BadgeTone }> = {
  live: { label: 'Live', tone: 'okSubtle' },
  behind: { label: 'Behind', tone: 'warnSubtle' },
  probe_failed: { label: 'Check failed', tone: 'dangerSubtle' },
  unobserved: { label: 'Not observed', tone: 'neutral' },
  not_comparable: { label: 'Cannot compare', tone: 'neutral' },
}

function DeployPanel({ view }: { view: DeployView }) {
  if (view.targets.length === 0) {
    return (
      <p className="text-xs text-fg-secondary">
        No deploy targets are declared. Add <span className="font-mono">deploy.targets</span> to mushi.recipe.json with a version probe to see what each
        target runs.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-secondary">
        Expected: <span className="font-mono text-fg">{short(view.expectedCommit)}</span> (default-branch head)
        {view.expectedVersion ? (
          <>
            , release <span className="font-mono text-fg">{view.expectedVersion}</span>
          </>
        ) : null}
        .
      </p>
      <ul className="space-y-2">
        {view.targets.map((t) => {
          const meta = DEPLOY_STATUS[t.status] ?? DEPLOY_STATUS.unobserved
          return (
            <li key={t.id} className="space-y-1 rounded-sm border border-edge-subtle/60 p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-fg wrap-break-word">{t.id}</span>
                <Badge tone={meta.tone}>{meta.label}</Badge>
                {(t.kind || t.environment) && (
                  <span className="text-2xs text-fg-muted">{[t.kind, t.environment].filter(Boolean).join(' · ')}</span>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-2 text-2xs">
                <dt className="text-fg-faint">Expected</dt>
                <dt className="text-fg-faint">Observed</dt>
                <dd className="font-mono text-fg-secondary">{short(t.expected.commit)}</dd>
                <dd className="font-mono text-fg-secondary">
                  {t.observed ? `${short(t.observed.commit)}${t.observed.version ? ` · ${t.observed.version}` : ''}` : '—'}
                </dd>
              </dl>
              <p className="text-2xs text-fg-muted wrap-break-word">
                {t.reason}
                {t.observed ? ` Checked ${when(t.observed.at)}.` : ''}
              </p>
            </li>
          )
        })}
      </ul>
      {view.undeclared.length > 0 && (
        <p className="text-2xs text-fg-muted">
          Observed but no longer declared: <span className="font-mono">{view.undeclared.join(', ')}</span>
        </p>
      )}
    </div>
  )
}

// ── env ──────────────────────────────────────────────────────────────────────

const ENV_CELL: Record<EnvCell, { label: string; tone: BadgeTone | null }> = {
  present: { label: 'Set', tone: 'okSubtle' },
  missing: { label: 'Missing', tone: 'dangerSubtle' },
  extra: { label: 'Set, not declared', tone: 'infoSubtle' },
  not_checked: { label: 'Not checked', tone: 'warnSubtle' },
  not_required: { label: '—', tone: null },
}

function EnvPanel({ view }: { view: EnvView }) {
  if (view.rows.length === 0) {
    return <p className="text-xs text-fg-secondary">No env names are declared or found. Declare them in the Change tab.</p>
  }
  const unchecked = view.columns.filter((c) => !c.checked && c.key !== 'runtime')
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-secondary">Names only: where each variable must be set, and whether GitHub has it. Values never leave GitHub.</p>
      <TableShell label="Environment by variable">
        <thead>
          <tr>
            <DataTableHead>Variable</DataTableHead>
            {view.columns.map((c) => (
              <DataTableHead key={c.key}>{c.label}</DataTableHead>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.name} className="border-t border-edge-subtle">
              <DataTableCell>
                <span className="font-mono wrap-break-word">{r.name}</span>
                {!r.declared && <span className="block text-2xs text-fg-faint">not declared</span>}
              </DataTableCell>
              {view.columns.map((c) => {
                const meta = ENV_CELL[r.cells[c.key] ?? 'not_required'] ?? ENV_CELL.not_required
                return (
                  <DataTableCell key={c.key}>
                    {meta.tone ? <Badge tone={meta.tone}>{meta.label}</Badge> : <span className="text-fg-faint" aria-label="Not required here">—</span>}
                  </DataTableCell>
                )
              })}
            </tr>
          ))}
        </tbody>
      </TableShell>
      {unchecked.length > 0 && (
        <p className="text-2xs text-fg-muted">
          {unchecked.map((c) => c.label).join(', ')}: GitHub did not list these names (the token may lack the secrets permission), so they are not checked.
        </p>
      )}
      {view.truncated && <p className="text-2xs text-fg-muted">More undeclared names exist than are shown.</p>}
    </div>
  )
}

export function RecipeElementView({ view }: { view: ElementView }) {
  switch (view.kind) {
    case 'schema':
      return <SchemaPanel view={view.view} />
    case 'ci':
      return <CiPanel view={view.view} />
    case 'deploy':
      return <DeployPanel view={view.view} />
    case 'env':
      return <EnvPanel view={view.view} />
  }
}
