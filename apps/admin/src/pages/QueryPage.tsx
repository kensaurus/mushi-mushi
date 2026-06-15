import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { QueryStatusBanner } from '../components/query/QueryStatusBanner'
import { EMPTY_QUERY_STATS, type QueryStats, type QueryTabId } from '../components/query/types'
import {
  errors24hDetail,
  errors24hTooltip,
  latencyDetail,
  latencyTooltip,
  runs24hDetail,
  runs24hTooltip,
  savedCountDetail,
  savedCountTooltip,
} from '../lib/statTooltips/query'
import { queryLinks } from '../lib/statCardLinks'
import { SetupNudge } from '../components/SetupNudge'
import { PageScopeHint,SnapshotSectionHint,PageHeader,
  PageHelp,
  Card,
  Btn,
  RelativeTime,
  Section,
  Loading,
  Skeleton,
  ErrorAlert,
  SegmentedControl,
  Kbd,
  Tooltip,
  Badge,
  StatCard, } from '../components/ui'
import {
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import {
  IconClock,
  IconReports,
  IconUser,
  IconCamera,
  IconJudge,
  IconCopy,
  IconCheck,
} from '../components/icons'
import { useToast } from '../lib/toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageHero } from '../components/PageHero'
import { useNextBestAction } from '../lib/useNextBestAction'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'

type QueryMode = 'nl' | 'raw'

interface QueryResult {
  sql: string
  explanation?: string
  results: unknown[]
  summary?: string
  latencyMs?: number
  rowCount?: number
}

interface HistoryRow {
  id: string
  prompt: string
  sql: string | null
  summary: string | null
  explanation: string | null
  row_count: number
  error: string | null
  latency_ms: number | null
  is_saved?: boolean
  mode?: QueryMode
  created_at: string
}

interface TeamRow extends HistoryRow {
  user_id: string | null
  author_email: string | null
  author_name: string | null
}

interface RunItem {
  id: string
  question: string
  mode: QueryMode
  result?: QueryResult
  error?: string
  latencyMs?: number
}

type SidebarTab = 'saved' | 'recent' | 'team'

// Approved tables for raw SQL mode — mirrors the backend APPROVED_TABLES set.
// Shown in the schema reference panel so users know what to query.
const SCHEMA_REFERENCE = [
  {
    table: 'reports',
    columns: 'id, project_id, status, category, severity, summary, component, description, confidence, created_at, judge_score, bug_ontology_tags, fix_pr_url, fixed_at, app_version, sdk_version',
    note: 'severity: critical=P0, high=P1, medium=P2, low=P3',
  },
  {
    table: 'report_groups',
    columns: 'id, project_id, canonical_report_id, status, report_count, created_at',
    note: null,
  },
  {
    table: 'classification_evaluations',
    columns: 'id, project_id, report_id, judge_score, accuracy_score, severity_score, component_score, repro_score, created_at',
    note: null,
  },
  {
    table: 'reporter_reputation',
    columns: 'id, project_id, reporter_token_hash, reputation_score, total_points, confirmed_bugs, dismissed_reports, total_reports',
    note: null,
  },
  {
    table: 'fix_attempts',
    columns: 'id, report_id, project_id, agent, status, pr_url, files_changed, lines_changed, summary, started_at, completed_at',
    note: null,
  },
  {
    table: 'fix_verifications',
    columns: 'id, report_id, verification_status, visual_diff_score, verified_at',
    note: null,
  },
  {
    table: 'graph_nodes',
    columns: 'id, project_id, node_type, label, metadata, created_at',
    note: null,
  },
  {
    table: 'bug_ontology',
    columns: 'id, project_id, tag, parent_tag, description, usage_count',
    note: null,
  },
] as const

const RAW_SQL_TEMPLATE = `SELECT
  severity,
  COUNT(*) AS count
FROM reports
WHERE project_id = $1
  AND created_at >= date_trunc('week', now())
GROUP BY severity
ORDER BY count DESC
LIMIT 100`

// Category-keyed prompt library. Replaces the previous flat SUGGESTIONS row +
// SQL_HINTS card stack — those two surfaces were showing the same kind of
// hint twice (once as a button, once as a list item with an italic "why
// this works" caption), which read as a wall of text on first paint.
// Categorising by user intent (Trends / Components / Reporters / Telemetry
// / Quality) chunks the choice (Hick's Law) and lets the operator skip to
// the lane they came for. The `why` line stays as a hover tooltip rather
// than a permanent caption — progressive disclosure (NN/g #8).
interface PromptItem {
  prompt: string
  why: string
}
interface PromptCategory {
  id: string
  label: string
  icon: ReactNode
  /** Tailwind tone class — applied as bg/text on the active tab + the
   *  category icon swatch so the user can tell categories apart at a
   *  glance even after the tab strip scrolls out of view. */
  tone:
    | 'text-info'
    | 'text-brand'
    | 'text-ok'
    | 'text-warn'
    | 'text-fg-secondary'
  blurb: string
  prompts: PromptItem[]
}

const PROMPT_CATEGORIES: readonly PromptCategory[] = [
  {
    id: 'trends',
    label: 'Trends',
    icon: <IconClock />,
    tone: 'text-info',
    blurb: 'Time-bucketed deltas — phrase the comparison explicitly.',
    prompts: [
      {
        prompt: 'How many P0/P1 reports landed this week vs last week?',
        why: 'Anchor the LLM on a concrete comparison so it picks the right time-bucket SQL.',
      },
      {
        prompt: 'How many critical bugs were reported this week?',
        why: 'Single-bucket count over the rolling 7d window — fastest to verify by eyeballing.',
      },
      {
        prompt: 'List components that regressed (fixed → reopened) in the last 30 days',
        why: 'Mention "regressed" so the LLM joins reports.fixed_at with later events.',
      },
    ],
  },
  {
    id: 'components',
    label: 'Components',
    icon: <IconReports />,
    tone: 'text-brand',
    blurb: 'Group reports by surface, package, or feature.',
    prompts: [
      {
        prompt: 'Which component has the most bugs?',
        why: 'Single-column GROUP BY — easy to validate against your gut feel.',
      },
      {
        prompt: 'Top 5 components by report count this month',
        why: 'Pre-bound limit + window keeps the result set small + the LLM cheap.',
      },
      {
        prompt: 'Show reports that might be regressions',
        why: 'Lets the LLM lean on `is_regression` heuristics in the schema.',
      },
    ],
  },
  {
    id: 'reporters',
    label: 'Reporters',
    icon: <IconUser />,
    tone: 'text-ok',
    blurb: 'Slice by who reported, with reputation + agreement signals.',
    prompts: [
      {
        prompt: 'Which reporters have the highest agreement rate with the judge?',
        why: 'Anchor on a known metric (classification_agreed) so the SQL stays read-only.',
      },
      {
        prompt: 'List dismissed reports with low reputation reporters',
        why: 'Pairs status + reputation in one filter — good signal-to-noise sample.',
      },
    ],
  },
  {
    id: 'telemetry',
    label: 'Telemetry',
    icon: <IconCamera />,
    tone: 'text-warn',
    blurb: 'Coverage of screenshots, console logs, repro steps.',
    prompts: [
      {
        prompt: 'Reports with screenshots but no console logs in the last 7 days',
        why: 'Pair two columns to test telemetry coverage end-to-end.',
      },
      {
        prompt: 'Average classifier latency by model over the last 14 days',
        why: 'Time window keeps the result set small + the LLM cheap.',
      },
    ],
  },
  {
    id: 'quality',
    label: 'Quality',
    icon: <IconJudge />,
    tone: 'text-fg-secondary',
    blurb: 'Judge scores, classification agreement, fix outcomes.',
    prompts: [
      {
        prompt: 'Average judge score by week (last 4 weeks)',
        why: 'Bounded series — render the trend without paginating.',
      },
      {
        prompt: 'Which classifier model has the best agreement with the judge?',
        why: 'Direct head-to-head — cite a single metric so the SQL stays sharp.',
      },
    ],
  },
]

function asTable(rows: unknown[]): { columns: string[]; data: Record<string, unknown>[] } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const objects = rows.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
  if (objects.length === 0) return null
  const cols = new Set<string>()
  for (const obj of objects.slice(0, 50)) {
    for (const k of Object.keys(obj)) cols.add(k)
  }
  return { columns: [...cols], data: objects }
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true)
            toast.success('Copied to clipboard')
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => toast.error('Could not copy'))
      }}
      className="inline-flex items-center gap-1 text-3xs text-fg-faint hover:text-fg motion-safe:transition-colors px-1.5 py-0.5 rounded-sm hover:bg-surface-overlay/50"
      aria-label={label}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  )
}

// One row of the user's saved/recent history list. The pin + delete buttons
// are touch-visible at narrow viewports (≤ pointer:coarse) and hover-revealed
// on desktop — `focus-within` keeps them keyboard-reachable too.
function HistoryItem({
  row,
  onRerun,
  onToggleSave,
  onDelete,
}: {
  row: HistoryRow
  onRerun: () => void
  onToggleSave: () => void
  onDelete: () => void
}) {
  return (
    <li className="rounded-sm border border-edge-subtle p-2 hover:bg-surface-overlay/30 motion-safe:transition-colors group focus-within:border-edge">
      <button
        type="button"
        onClick={onRerun}
        className="text-left w-full text-2xs text-fg-secondary hover:text-fg"
        title={row.error ?? 'Click to rerun'}
      >
        <span className="inline-flex items-center gap-1.5 w-full min-w-0">
          {row.mode === 'raw' && (
            <span className="inline-flex shrink-0 px-1 py-0.5 rounded-[2px] text-2xs font-mono font-medium bg-warn-muted/50 text-warning-foreground border border-warn/20">SQL</span>
          )}
          <span className="line-clamp-2">{row.prompt}</span>
        </span>
      </button>
      <div className="flex items-center justify-between mt-1 text-3xs text-fg-faint font-mono gap-1">
        <span className="truncate">
          <RelativeTime value={row.created_at} />
          {row.error ? (
            <span className="ml-1 text-danger">· error</span>
          ) : (
            <span className="ml-1">
              · {row.row_count} row{row.row_count === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleSave}
            className={`motion-safe:transition-opacity hover:text-brand ${
              row.is_saved ? 'text-brand' : 'opacity-60 group-hover:opacity-100 group-focus-within:opacity-100'
            }`}
            aria-label={row.is_saved ? 'Unpin saved query' : 'Pin to Saved'}
            title={row.is_saved ? 'Unpin saved query' : 'Pin to Saved'}
          >
            {row.is_saved ? '★' : '☆'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 motion-safe:transition-opacity hover:text-danger"
            aria-label="Delete history entry"
          >
            ✕
          </button>
        </span>
      </div>
    </li>
  )
}

// Teammate-saved query row. Shows the author's display name as the primary
// attribution chip — without that the Team tab would be indistinguishable
// from "Saved" except for "wait, why does it have a different prompt?".
function TeamItem({ row, onRerun }: { row: TeamRow; onRerun: () => void }) {
  const display = row.author_name ?? row.author_email ?? 'Teammate'
  const initial = (row.author_name ?? row.author_email ?? '?').charAt(0).toUpperCase()
  return (
    <li className="rounded-sm border border-edge-subtle p-2 hover:bg-surface-overlay/30 motion-safe:transition-colors group">
      <button
        type="button"
        onClick={onRerun}
        className="text-left w-full text-2xs text-fg-secondary hover:text-fg"
        title={`Run this query (saved by ${display})`}
      >
        <span className="line-clamp-2">{row.prompt}</span>
      </button>
      <div className="flex items-center justify-between mt-1.5 text-3xs gap-1">
        <span className="flex items-center gap-1 min-w-0">
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand/15 text-brand font-medium text-3xs shrink-0"
            aria-hidden="true"
          >
            {initial}
          </span>
          <span className="text-fg-secondary truncate" title={row.author_email ?? undefined}>
            {display}
          </span>
        </span>
        <span className="text-fg-faint font-mono shrink-0">
          <RelativeTime value={row.created_at} />
        </span>
      </div>
    </li>
  )
}

// ─── Cell rendering helpers ──────────────────────────────────────────────────

function headerLabel(col: string): string {
  return col
    .replace(/_id$/, ' ID')
    .replace(/_at$/, '')
    .replace(/_ms$/, ' (ms)')
    .replace(/_url$/, ' URL')
    .replace(/_count$/, ' count')
    .replace(/_score$/, ' score')
    .replace(/_hash$/, ' hash')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim()
}

function isNumericCol(col: string, sample: unknown): boolean {
  const c = col.toLowerCase()
  if (/count|score|total|points|ms|rows|weight|lines_changed|files_changed/.test(c)) return true
  return typeof sample === 'number'
}

function isDateCol(col: string): boolean {
  return /(_at|_date|created|updated|started|completed|verified|fixed|regressed)$/.test(col.toLowerCase())
}

function formatDate(v: string): string {
  try {
    const d = new Date(v)
    if (isNaN(d.getTime())) return v
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: diff > 365 * 86_400_000 ? 'numeric' : undefined })
  } catch {
    return v
  }
}

function CellBadge({ children, cls }: { children: string; cls: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-3xs font-medium leading-none ${cls}`}>
      {children}
    </span>
  )
}

function renderCell(col: string, val: unknown): ReactNode {
  const colL = col.toLowerCase()

  if (val == null || val === '') return <span className="text-fg-faint">—</span>

  // Boolean
  if (typeof val === 'boolean') {
    return val
      ? <span className="text-ok font-medium">✓</span>
      : <span className="text-fg-faint">✗</span>
  }

  const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
  const strL = str.toLowerCase()

  // Severity
  if (colL === 'severity') {
    const map: Record<string, string> = {
      critical: 'bg-danger-muted/50 text-danger-foreground border border-danger/30',
      high:     'bg-warn-muted/50 text-warning-foreground border border-warn/30',
      medium:   'bg-warn-muted/50 text-warning-foreground border border-warn/25',
      low:      'bg-info-muted/50 text-info-foreground border border-info/25',
    }
    const label: Record<string, string> = { critical: 'P0 critical', high: 'P1 high', medium: 'P2 medium', low: 'P3 low' }
    return <CellBadge cls={map[strL] ?? 'bg-surface-raised text-fg-secondary border border-edge-subtle'}>{label[strL] ?? str}</CellBadge>
  }

  // Status
  if (colL === 'status') {
    const map: Record<string, string> = {
      new:        'bg-brand/10 text-brand border border-brand/25',
      pending:    'bg-info-muted/50 text-info-foreground border border-info/25',
      submitted:  'bg-info-muted/50 text-info-foreground border border-info/25',
      queued:     'bg-info-muted/50 text-info-foreground border border-info/25',
      classified: 'bg-ok-muted/50 text-ok-foreground border border-ok/25',
      grouped:    'bg-ok-muted/50 text-ok-foreground border border-ok/25',
      fixing:     'bg-warn-muted/50 text-warning-foreground border border-warn/25',
      fixed:      'bg-ok-muted text-ok border border-ok/25',
      dismissed:  'bg-surface-raised text-fg-muted border border-edge-subtle',
      failed:     'bg-danger-muted/50 text-danger-foreground border border-danger/25',
    }
    return <CellBadge cls={map[strL] ?? 'bg-surface-raised text-fg-secondary border border-edge-subtle'}>{str}</CellBadge>
  }

  // Category
  if (colL === 'category') {
    const map: Record<string, string> = {
      bug:       'bg-danger-muted/50 text-danger-foreground border border-danger/25',
      slow:      'bg-warn-muted/50 text-warning-foreground border border-warn/25',
      visual:    'bg-accent-muted/55 text-accent-foreground border border-accent/25',
      confusing: 'bg-info-muted/50 text-info-foreground border border-info/25',
      other:     'bg-surface-raised text-fg-muted border border-edge-subtle',
    }
    return <CellBadge cls={map[strL] ?? 'bg-surface-raised text-fg-secondary border border-edge-subtle'}>{str}</CellBadge>
  }

  // Verification status
  if (colL === 'verification_status') {
    const map: Record<string, string> = {
      passed:  'bg-ok-muted text-ok border border-ok/25',
      failed:  'bg-danger-muted/50 text-danger-foreground border border-danger/25',
      pending: 'bg-info-muted/50 text-info-foreground border border-info/25',
    }
    return <CellBadge cls={map[strL] ?? 'bg-surface-raised text-fg-secondary border border-edge-subtle'}>{str}</CellBadge>
  }

  // Dates
  if (isDateCol(col) && typeof val === 'string' && val.includes('T')) {
    return (
      <span className="tabular-nums text-fg-muted" title={val}>
        {formatDate(val)}
      </span>
    )
  }

  // URLs
  if (colL.endsWith('_url') && typeof val === 'string' && val.startsWith('http')) {
    const short = val.replace(/^https?:\/\//, '').slice(0, 36)
    return (
      <a href={val} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2 hover:text-brand/80 transition-colors" title={val}>
        {short}{val.length > 36 ? '…' : ''}
      </a>
    )
  }

  // Score 0-1 range → show as %
  if (colL.endsWith('_score') && typeof val === 'number' && val >= 0 && val <= 1) {
    const pct = Math.round(val * 100)
    const cls = pct >= 80 ? 'text-ok' : pct >= 50 ? 'text-warn' : 'text-danger'
    return <span className={`tabular-nums font-medium ${cls}`}>{pct}%</span>
  }

  // Numbers
  if (typeof val === 'number') {
    const formatted = Number.isInteger(val)
      ? val.toLocaleString()
      : val.toFixed(2)
    return <span className="tabular-nums text-fg">{formatted}</span>
  }

  // Long strings → truncate with tooltip
  if (str.length > 60) {
    return <span title={str} className="text-fg-secondary">{str.slice(0, 58)}…</span>
  }

  return <span className="text-fg-secondary">{str}</span>
}

// ─── ResultsTable ─────────────────────────────────────────────────────────────

function ResultsTable({ rows }: { rows: unknown[] }) {
  const table = asTable(rows)
  if (!table) {
    return (
      <pre className="p-2 bg-surface-root rounded-sm text-2xs text-fg-muted overflow-x-auto max-h-64 font-mono">
        {JSON.stringify(rows.slice(0, 20), null, 2)}
      </pre>
    )
  }

  // Determine alignment per column based on first non-null value
  const sampleRow = table.data[0] ?? {}
  const numericCols = new Set(table.columns.filter((c) => isNumericCol(c, sampleRow[c])))

  return (
    <div className="overflow-x-auto -mx-3 mt-1">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-surface-raised border-b border-edge">
            {table.columns.map((c) => (
              <th
                key={c}
                className={`py-2 px-3 text-3xs font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap ${
                  numericCols.has(c) ? 'text-right' : 'text-left'
                }`}
              >
                {headerLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.data.slice(0, 50).map((row, i) => (
            <tr
              key={i}
              className={`border-b border-edge-subtle/50 hover:bg-surface-raised/30 motion-safe:transition-colors ${
                i % 2 === 1 ? 'bg-surface-root/30' : ''
              }`}
            >
              {table.columns.map((c) => (
                <td
                  key={c}
                  className={`py-2 px-3 align-middle max-w-[18rem] ${
                    numericCols.has(c) ? 'text-right' : ''
                  }`}
                >
                  {renderCell(c, row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.data.length > 50 && (
        <InlineProof className="mt-1.5 mx-3">
          Showing first 50 of {table.data.length} rows.
        </InlineProof>
      )}
    </div>
  )
}

// The categorised "Prompt library" panel. Replaces the previous wall of
// buttons (`SUGGESTIONS`) + bullet list (`SQL_HINTS`) which together
// rendered the same hint twice — once as a flat pill, once as a list
// item with an italic caption underneath. Hick's Law: chunk by user
// intent, show the "why" only on hover. Click a prompt to insert into
// the composer (so the operator can edit before running). Run-on-click
// is still available via the per-row run button when in a hurry.
function PromptLibrary({
  onInsert,
  onRun,
}: {
  onInsert: (prompt: string) => void
  onRun: (prompt: string) => void
}) {
  const [activeCat, setActiveCat] = useState<string>(PROMPT_CATEGORIES[0]!.id)
  const cat = PROMPT_CATEGORIES.find((c) => c.id === activeCat) ?? PROMPT_CATEGORIES[0]!
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
          Prompt library
        </h3>
        <span className="text-3xs text-fg-faint hidden sm:inline">
          Click to edit · <Kbd>↵</Kbd> to run from composer
        </span>
      </div>

      <div className="overflow-x-auto -mx-1 mb-2 pb-1">
        <div className="inline-flex items-center gap-0.5 px-1 rounded-md border border-edge-subtle bg-surface-raised/50 p-0.5 min-w-max">
          {PROMPT_CATEGORIES.map((c) => {
            const active = c.id === activeCat
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCat(c.id)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-sm text-2xs font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                  active
                    ? 'bg-brand text-brand-fg'
                    : 'text-fg-secondary hover:text-fg hover:bg-surface-overlay/50'
                }`}
              >
                <span className={`shrink-0 [&>svg]:h-3 [&>svg]:w-3 ${active ? '' : c.tone}`}>
                  {c.icon}
                </span>
                <span>{c.label}</span>
                <span
                  className={`font-mono ${
                    active ? 'text-brand-fg/70' : 'text-fg-faint'
                  }`}
                >
                  {c.prompts.length}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <p className="text-3xs text-fg-faint mb-2 leading-relaxed">{cat.blurb}</p>

      <ul className="space-y-1">
        {cat.prompts.map((p) => (
          <li
            key={p.prompt}
            className="group flex items-start gap-1 rounded-sm border border-transparent hover:border-edge-subtle hover:bg-surface-overlay/30 motion-safe:transition-colors"
          >
            <button
              type="button"
              onClick={() => onInsert(p.prompt)}
              title={p.why}
              className="flex-1 min-w-0 text-left px-2 py-1.5 text-2xs text-fg-secondary hover:text-fg motion-safe:transition-colors"
            >
              <span className="block">{p.prompt}</span>
              <span className="hidden group-hover:block group-focus-within:block text-3xs text-fg-faint mt-0.5 italic">
                {p.why}
              </span>
            </button>
            <Tooltip content="Run now" side="left">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRun(p.prompt)
                }}
                aria-label={`Run prompt: ${p.prompt}`}
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 motion-safe:transition-opacity px-2 py-1.5 text-3xs font-medium text-brand hover:text-brand-fg hover:bg-brand/15 rounded-sm"
              >
                Run →
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>
    </Card>
  )
}

const QUERY_TABS: Array<{ id: QueryTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Run health, PageHero decide/act/verify, and query posture for the active project.',
  },
  {
    id: 'ask',
    label: 'Ask',
    description: 'Natural-language or raw SQL composer with live results and prompt library.',
  },
  {
    id: 'history',
    label: 'History',
    description: 'Saved pins, recent runs, and teammate queries — rerun with one click.',
  },
  {
    id: 'schema',
    label: 'Schema',
    description: 'Approved read-only tables and columns — use $1 for project_id in raw SQL.',
  },
]

function isQueryTab(value: string | null): value is QueryTabId {
  return QUERY_TABS.some((t) => t.id === value)
}

export function QueryPage() {
  const copy = usePageCopy('/query')
  const activeProjectId = useActiveProjectId()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get('tab')
  const activeTab: QueryTabId = isQueryTab(tabParam) ? tabParam : 'overview'
  const activeTabMeta = QUERY_TABS.find((t) => t.id === activeTab) ?? QUERY_TABS[0]

  const statsPath = activeProjectId ? '/v1/admin/query/stats' : null
  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<QueryStats>(statsPath)
  const stats = statsData ?? EMPTY_QUERY_STATS

  const toast = useToast()
  const [queryMode, setQueryMode] = useState<QueryMode>('nl')
  const [question, setQuestion] = useState('')
  const [rawSql, setRawSql] = useState(RAW_SQL_TEMPLATE)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [runs, setRuns] = useState<RunItem[]>([])
  const [pendingDeleteHistory, setPendingDeleteHistory] = useState<HistoryRow | null>(null)
  const [deletingHistory, setDeletingHistory] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('saved')
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null)

  const {
    data: historyData,
    loading: historyLoading,
    reload: loadHistory,
    error: historyError,
  } = usePageData<{ history: HistoryRow[] }>(
    activeProjectId ? '/v1/admin/query/history?limit=25' : null,
  )
  const history = historyData?.history ?? []

  const {
    data: teamData,
    loading: teamLoading,
    reload: loadTeam,
    error: teamError,
  } = usePageData<{ team: TeamRow[] }>(
    activeProjectId ? '/v1/admin/query/team?limit=25' : null,
  )
  const team = teamData?.team ?? []

  const reloadAll = useCallback(() => {
    reloadStats()
    loadHistory()
    loadTeam()
  }, [reloadStats, loadHistory, loadTeam])

  useRealtimeReload(['nl_query_history'], reloadAll)

  const setActiveTab = useCallback(
    (id: QueryTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  async function handleSubmit(q?: string, overrideMode?: QueryMode) {
    const mode = overrideMode ?? queryMode
    const queryText = mode === 'raw'
      ? (q ?? rawSql).trim()
      : (q ?? question).trim()
    if (!queryText) return
    const id = `q${Date.now()}`
    setLoading(true)
    setRuns((prev) => [{ id, question: queryText, mode }, ...prev])
    if (mode === 'nl') setQuestion('')

    let res: Awaited<ReturnType<typeof apiFetch<QueryResult>>>
    if (mode === 'raw') {
      res = await apiFetch<QueryResult>('/v1/admin/query/raw', {
        method: 'POST',
        body: JSON.stringify({ sql: queryText }),
      })
    } else {
      res = await apiFetch<QueryResult>('/v1/admin/query', {
        method: 'POST',
        body: JSON.stringify({ question: queryText }),
      })
    }

    setLoading(false)
    if (res.ok && res.data) {
      setRuns((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, result: res.data, latencyMs: res.data?.latencyMs } : r,
        ),
      )
    } else {
      const err = res.error?.message ?? 'Query failed'
      setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, error: err } : r)))
      toast.error(mode === 'raw' ? 'SQL error' : 'Query failed', err)
    }
    loadHistory()
    loadTeam()
    reloadStats()
  }

  async function confirmDeleteHistory() {
    if (!pendingDeleteHistory) return
    setDeletingHistory(true)
    const res = await apiFetch(`/v1/admin/query/history/${pendingDeleteHistory.id}`, {
      method: 'DELETE',
    })
    setDeletingHistory(false)
    setPendingDeleteHistory(null)
    if (res.ok) {
      toast.success('Query removed from history')
      loadHistory()
    } else {
      toast.error('Failed to delete', res.error?.message)
    }
  }

  async function toggleSaved(row: HistoryRow) {
    const next = !(row.is_saved ?? false)
    const res = await apiFetch(`/v1/admin/query/history/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_saved: next }),
    })
    if (res.ok) {
      toast.success(next ? 'Pinned to Saved' : 'Unpinned from Saved')
      loadHistory()
      loadTeam()
    } else {
      toast.error('Could not update', res.error?.message)
    }
  }

  // Save the most recent run by re-issuing the prompt's history row PATCH —
  // we need its id, which is in the history list. Match by prompt text on
  // the most recent row (race-safe enough: the user just ran it). If the
  // history list is still loading, fall back to a no-op + toast so the
  // affordance never lies.
  async function saveQuestion(prompt: string) {
    const match = history.find((h) => h.prompt === prompt)
    if (!match) {
      toast.error('Could not save', 'History row not found yet — try again in a moment.')
      return
    }
    if (match.is_saved) return
    await toggleSaved(match)
  }

  const saved = useMemo(() => history.filter((h) => h.is_saved), [history])
  const recent = useMemo(() => history.filter((h) => !h.is_saved), [history])
  const lastRunHoursAgo = stats.lastRunAt
    ? Math.floor((Date.now() - new Date(stats.lastRunAt).getTime()) / 3_600_000)
    : history[0]?.created_at
      ? Math.floor((Date.now() - new Date(history[0].created_at).getTime()) / 3_600_000)
      : null
  const queryAction = useNextBestAction({
    scope: 'query',
    savedQueries: saved.length,
    lastRunHoursAgo,
  })
  const querySeverity: 'crit' | 'warn' | 'ok' | 'neutral' | 'info' =
    stats.errors24h > 0
      ? 'crit'
      : stats.runs24h === 0 && stats.savedCount === 0
        ? 'neutral'
        : stats.savedCount === 0
          ? 'info'
          : 'ok'

  usePublishPageContext({
    route: '/query',
    title: `${activeTabMeta.label} · Ask Your Data`,
    summary: activeTabMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: stats.errors24h,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      {
        id: 'ask' as const,
        label: 'Ask',
        count: stats.runs24h > 0 ? stats.runs24h : undefined,
      },
      {
        id: 'history' as const,
        label: 'History',
        count: saved.length + recent.length > 0 ? saved.length + recent.length : undefined,
      },
      { id: 'schema' as const, label: 'Schema' },
    ],
    [stats.runs24h, saved.length, recent.length],
  )

  // Map prompt → boolean so a run card can render "Saved" once the row
  // exists in history. Keyed by prompt text because the run-card only
  // owns the question string, not the eventual history-row id.
  const isSavedPrompt = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const h of history) map.set(h.prompt, !!h.is_saved)
    return map
  }, [history])

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeader title={copy?.title ?? 'Ask Your Data'} />
      <PageScopeHint text={copy?.description ?? "Natural-language or raw SQL analytics against approved tables."} />
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Queries are scoped per project — pick mushi-mushi (or your app) first."
        />
      </div>
    )
  }

  if (statsLoading && !statsData) {
    return <TableSkeleton rows={5} columns={4} showFilters label="Loading query stats" />
  }
  if (statsError) {
    return <ErrorAlert message={`Failed to load query stats: ${statsError}`} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Ask Your Data'}
        projectScope={stats.projectName ?? undefined}
      >
        <Badge className={stats.errors24h > 0 ? 'bg-danger-subtle text-danger' : stats.runs24h > 0 ? 'bg-ok-muted text-ok' : 'bg-info-muted/50 text-info-foreground'}>
          {stats.errors24h > 0 ? `${stats.errors24h} FAIL 24H` : stats.runs24h > 0 ? `${stats.runs24h} RUNS 24H` : 'READY'}
        </Badge>
      </PageHeader>
      <PageScopeHint text={copy?.description ?? "Natural-language or raw SQL analytics against approved tables."} />

      {(stats.schemaDegraded || stats.errors24h > 0) && (
        <QueryStatusBanner
          stats={stats}
          onTab={setActiveTab}
          onViewErrors={() => {
            setActiveTab('history')
            setSidebarTab('recent')
          }}
        />
      )}

      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Query sections"
        size="sm"
      />

      {activeTab === 'overview' && (
        <PageHero
          scope="query"
          title="Ask Your Data"
          kicker="Natural-language analytics"
          decide={{
            label:
              stats.runs24h === 0 && stats.savedCount === 0
                ? 'No queries yet'
                : stats.savedCount === 0
                  ? 'No saved queries'
                  : 'Saved queries ready',
            metric: `${stats.savedCount} saved · ${stats.recentCount} recent · ${stats.teamSavedCount} from team`,
            summary:
              stats.runs24h === 0 && stats.savedCount === 0
                ? 'Ask your first question — the LLM writes the SQL, you see the rows. No setup required.'
                : stats.savedCount === 0
                  ? 'Save a useful query so it becomes a one-click tile for your team.'
                  : 'Rerun any saved query from History or edit the SQL before running.',
            severity: querySeverity,
            anchor: 'query:decide',
            evidence: {
              kind: 'metric-breakdown',
              items: [
                { label: 'Saved', value: stats.savedCount, tone: stats.savedCount > 0 ? 'ok' : 'neutral' },
                { label: 'Recent', value: stats.recentCount, tone: stats.recentCount > 0 ? 'info' : 'neutral' },
                { label: 'Team', value: stats.teamSavedCount, tone: stats.teamSavedCount > 0 ? 'info' : 'neutral' },
                { label: 'Errors 24h', value: stats.errors24h, tone: stats.errors24h > 0 ? 'crit' : 'ok' },
              ],
            },
          }}
          act={queryAction}
          actAnchor="query:act"
          actEvidence={queryAction ? { kind: 'rule-trace', why: queryAction.reason ?? queryAction.title } : undefined}
          verify={{
            label: 'Latest activity',
            detail:
              lastRunHoursAgo == null
                ? 'No queries run yet'
                : lastRunHoursAgo < 1
                  ? 'Last run less than an hour ago'
                  : `Last run ${lastRunHoursAgo}h ago`,
            to: '/query?tab=history',
            secondaryTo: '/query?tab=ask',
            secondaryLabel: 'New query',
            anchor: 'query:verify',
            evidence: stats.lastRunAt ? {
              kind: 'last-event',
              at: stats.lastRunAt,
              by: 'user',
              payloadSummary: stats.lastRunPrompt?.slice(0, 60) ?? 'Query run',
              status: stats.lastRunError ? 'error' : 'ok',
            } : undefined,
          }}
        />
      )}

      <Section title="Query snapshot" freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
        <SnapshotSectionHint text={activeTabMeta.description} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Runs 24h"
            value={stats.runs24h}
            accent={stats.runs24h > 0 ? 'text-brand' : undefined}
            tooltip={runs24hTooltip(stats)}
            detail={runs24hDetail(stats)}
            to={queryLinks.runs24h}
          />
          <StatCard
            label="Errors 24h"
            value={stats.errors24h}
            accent={stats.errors24h > 0 ? 'text-danger' : 'text-ok'}
            tooltip={errors24hTooltip(stats)}
            detail={errors24hDetail(stats)}
            to={queryLinks.errors24h}
          />
          <StatCard
            label="Saved"
            value={stats.savedCount}
            accent={stats.savedCount > 0 ? 'text-ok' : 'text-warn'}
            tooltip={savedCountTooltip(stats)}
            detail={savedCountDetail(stats)}
            to={queryLinks.saved}
          />
          <StatCard
            label="Latency"
            value={stats.avgLatencyMs != null ? `${stats.avgLatencyMs}ms` : '—'}
            accent="text-info"
            tooltip={latencyTooltip(stats)}
            detail={latencyDetail(stats)}
            to={queryLinks.latency}
          />
        </div>
      </Section>

      {activeTab === 'overview' && (
        <PageHelp
        title={copy?.help?.title ?? 'About Ask Your Data'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'Natural-language or raw SQL interface to approved bug tables — every run is sandboxed and logged.'
        }
        useCases={copy?.help?.useCases ?? []}
        howToUse={copy?.help?.howToUse ?? 'Use the Ask tab to run queries. History pins favorites. Schema lists approved tables.'}
      />
      )}

      {activeTab === 'schema' && (
        <Card className="p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider">Approved tables</div>
          <ContainedBlock tone="muted" className="mb-3">
            <p className="text-2xs leading-relaxed text-fg-muted">
              Raw SQL mode accepts SELECT-only statements. Bind your project with <code className="text-brand">$1</code> — max 100 rows returned.
            </p>
          </ContainedBlock>
          <div className="divide-y divide-edge-subtle/30 rounded-sm border border-edge-subtle overflow-hidden">
            {SCHEMA_REFERENCE.map((t) => (
              <div key={t.table} className="px-3 py-2 grid grid-cols-[7rem_1fr] gap-2 items-start bg-surface-raised/30">
                <code className="text-2xs font-mono text-brand shrink-0">{t.table}</code>
                <span className="text-3xs text-fg-faint font-mono leading-relaxed">
                  {t.columns}
                  {t.note ? <span className="block text-info/80 not-italic mt-0.5">{t.note}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(activeTab === 'ask' || activeTab === 'history') && (
        <>
      {activeTab === 'ask' && (
      <>
      {/* ── Composer ─────────────────────────────────────────────────────── */}
      <Card className="p-4 md:p-5 border-brand/20 bg-gradient-to-b from-brand/[0.04] to-transparent">
        {/* Mode toggle */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="inline-flex items-center gap-0.5 rounded-sm border border-edge-subtle bg-surface-raised p-0.5">
            <button
              type="button"
              onClick={() => setQueryMode('nl')}
              aria-pressed={queryMode === 'nl'}
              className={`px-3 py-1 rounded-[2px] text-2xs font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                queryMode === 'nl'
                  ? 'bg-brand text-brand-fg'
                  : 'text-fg-secondary hover:text-fg hover:bg-surface-overlay/50'
              }`}
            >
              Natural language
            </button>
            <button
              type="button"
              onClick={() => { setQueryMode('raw'); setTimeout(() => rawTextareaRef.current?.focus(), 0) }}
              aria-pressed={queryMode === 'raw'}
              className={`px-3 py-1 rounded-[2px] text-2xs font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                queryMode === 'raw'
                  ? 'bg-brand text-brand-fg'
                  : 'text-fg-secondary hover:text-fg hover:bg-surface-overlay/50'
              }`}
            >
              Raw SQL
            </button>
          </div>
          {queryMode === 'raw' && (
            <button
              type="button"
              onClick={() => setSchemaOpen((o) => !o)}
              className="text-2xs text-fg-secondary hover:text-fg inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-edge-subtle hover:bg-surface-overlay/30 motion-safe:transition-colors"
              aria-expanded={schemaOpen}
            >
              {schemaOpen ? '▾' : '▸'} Schema
            </button>
          )}
        </div>

        {/* Schema reference — shown only in raw SQL mode */}
        {queryMode === 'raw' && schemaOpen && (
          <div className="mb-3 rounded-sm border border-edge-subtle bg-surface-raised/50 overflow-hidden">
            <div className="px-3 py-2 border-b border-edge-subtle/50 flex items-center justify-between">
              <span className="text-2xs font-medium text-fg-secondary">Approved tables · <code className="text-brand">$1</code> = your project_id</span>
              <span className="text-3xs text-fg-faint">severity: critical=P0 high=P1 medium=P2 low=P3</span>
            </div>
            <div className="divide-y divide-edge-subtle/30 max-h-48 overflow-y-auto">
              {SCHEMA_REFERENCE.map((t) => (
                <div key={t.table} className="px-3 py-1.5 grid grid-cols-[7rem_1fr] gap-2 items-start">
                  <code className="text-2xs font-mono text-brand shrink-0">{t.table}</code>
                  <span className="text-3xs text-fg-faint font-mono leading-relaxed">
                    {t.columns}
                    {t.note && <span className="block text-info/80 not-italic mt-0.5">{t.note}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3" data-dav-anchor="query:act">
          {queryMode === 'nl' ? (
            <>
              <label htmlFor="query-composer" className="block text-xs font-medium text-fg-muted">
                Ask a question about your bug data
              </label>
              <div className="flex gap-2 items-stretch">
                <textarea
                  id="query-composer"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
                  }}
                  placeholder="e.g. How many P0/P1 reports landed this week vs last week?"
                  disabled={loading}
                  rows={2}
                  className="flex-1 min-w-0 bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2.5 text-sm text-fg placeholder:text-fg-faint hover:border-edge focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors resize-y"
                  aria-label="Question composer"
                />
                <Btn
                  onClick={() => handleSubmit()}
                  disabled={loading || !question.trim()}
                  loading={loading}
                  className="px-6 text-sm shrink-0 self-stretch"
                >
                  {loading ? 'Running…' : 'Ask →'}
                </Btn>
              </div>
              <div className="flex items-center justify-between gap-2 text-3xs text-fg-faint flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>↵</Kbd><span>to run</span>
                  <span className="opacity-40">·</span>
                  <span>Read-only · sandboxed · every query is logged</span>
                </span>
                {question.trim() && (
                  <button type="button" onClick={() => setQuestion('')} className="text-fg-faint hover:text-fg motion-safe:transition-colors">Clear</button>
                )}
              </div>
            </>
          ) : (
            <>
              <label htmlFor="raw-sql-composer" className="block text-xs font-medium text-fg-muted">
                Write SQL directly — use <code className="text-brand">$1</code> for your project_id
              </label>
              <div className="flex gap-2 items-stretch">
                <textarea
                  id="raw-sql-composer"
                  ref={rawTextareaRef}
                  value={rawSql}
                  onChange={(e) => setRawSql(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSubmit() }
                  }}
                  disabled={loading}
                  rows={6}
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2.5 text-sm text-fg font-mono placeholder:text-fg-faint hover:border-edge focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors resize-y"
                  aria-label="Raw SQL composer"
                />
                <Btn
                  onClick={() => handleSubmit()}
                  disabled={loading || !rawSql.trim()}
                  loading={loading}
                  className="px-6 text-sm shrink-0 self-stretch"
                >
                  {loading ? 'Running…' : 'Run →'}
                </Btn>
              </div>
              <div className="flex items-center justify-between gap-2 text-3xs text-fg-faint flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>⌘↵</Kbd><span>to run</span>
                  <span className="opacity-40">·</span>
                  <span>SELECT only · $1 = project_id · max 100 rows · every query is logged</span>
                </span>
                <button
                  type="button"
                  onClick={() => setRawSql(RAW_SQL_TEMPLATE)}
                  className="text-fg-faint hover:text-fg motion-safe:transition-colors"
                >
                  Reset template
                </button>
              </div>
            </>
          )}
        </div>

        {/* Quick-fire suggestion chips — NL mode only */}
        {queryMode === 'nl' && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-edge-subtle/50">
            {PROMPT_CATEGORIES.flatMap((c) => c.prompts)
              .slice(0, 5)
              .map((p) => (
                <button
                  key={p.prompt}
                  type="button"
                  onClick={() => { setQuestion(p.prompt); handleSubmit(p.prompt, 'nl') }}
                  disabled={loading}
                  className="text-2xs px-2.5 py-1 rounded-full border border-edge-subtle text-fg-secondary hover:bg-brand/10 hover:border-brand/30 hover:text-fg motion-safe:transition-colors disabled:opacity-40"
                >
                  {p.prompt.length > 48 ? p.prompt.slice(0, 48) + '…' : p.prompt}
                </button>
              ))}
          </div>
        )}
      </Card>
      </>
      )}

      <div className={`grid gap-3 ${activeTab === 'history' ? '' : 'md:grid-cols-[1fr_18rem]'}`}>
        {activeTab === 'ask' && (
        <div className="space-y-3 min-w-0">
          {/* Run results — live results push down, prompt library hides when runs exist */}
          {runs.length > 0 ? (
            <div className="space-y-2">
              {runs.map((run) => {
                const alreadySaved = run.mode === 'nl' && (isSavedPrompt.get(run.question) ?? false)
                const rowCount = run.result?.results?.length ?? run.result?.rowCount ?? 0
                return (
                  <Card key={run.id} className="p-3 space-y-2">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {run.mode === 'raw' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-2xs font-mono font-medium bg-warn-muted/50 text-warning-foreground border border-warn/20">SQL</span>
                          )}
                          <p className="text-sm text-fg font-medium break-words line-clamp-3">
                            {run.question}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {run.latencyMs != null && (
                          <Badge title={run.mode === 'raw' ? 'Query latency' : 'LLM + SQL latency'}>
                            {run.latencyMs}ms
                          </Badge>
                        )}
                        {run.result && run.mode === 'nl' && (
                          <Tooltip content={alreadySaved ? 'Already in Saved' : 'Pin to Saved'} side="left">
                            <button
                              type="button"
                              onClick={() => void saveQuestion(run.question)}
                              disabled={alreadySaved}
                              className={`text-base motion-safe:transition-colors ${alreadySaved ? 'text-brand cursor-default' : 'text-fg-faint hover:text-brand'}`}
                              aria-label={alreadySaved ? 'Already saved' : 'Pin to Saved'}
                            >
                              {alreadySaved ? '★' : '☆'}
                            </button>
                          </Tooltip>
                        )}
                        {run.result && (
                          <Btn variant="ghost" size="sm" onClick={() => handleSubmit(run.question, run.mode)} disabled={loading}>
                            Rerun
                          </Btn>
                        )}
                      </div>
                    </div>

                    {/* Loading */}
                    {!run.result && !run.error && (
                      <Loading text={run.mode === 'raw' ? 'Running SQL…' : 'Generating SQL and running…'} />
                    )}

                    {/* Error */}
                    {run.error && (
                      <ContainedBlock tone="warn">
                        <p className="text-xs text-danger">
                          <strong>Error.</strong> {run.error}
                        </p>
                      </ContainedBlock>
                    )}

                    {/* Success */}
                    {run.result && (
                      <>
                        {/* NL summary — prominent answer */}
                        {run.result.summary && (
                          <p className="text-sm text-fg leading-relaxed font-medium">{run.result.summary}</p>
                        )}
                        {run.result.explanation && (
                          <InlineProof className="italic -mt-1">{run.result.explanation}</InlineProof>
                        )}

                        {/* Results table (shown before SQL so users see data first) */}
                        {rowCount > 0 && (
                          <div className="rounded-sm border border-edge-subtle overflow-hidden">
                            <ResultsTable rows={run.result.results} />
                            <div className="flex items-center justify-between gap-2 border-t border-edge-subtle/50 bg-surface-raised/30 px-3 py-1.5">
                              <SignalChip tone="neutral">
                                {rowCount} row{rowCount === 1 ? '' : 's'}
                              </SignalChip>
                            </div>
                          </div>
                        )}
                        {rowCount === 0 && !run.error && (
                          <EmptySectionMessage
                            text="Query ran successfully but returned 0 rows."
                            hint="Check your filters or date range."
                          />
                        )}

                        {/* SQL block — collapsible, open by default in raw mode */}
                        <div className="rounded-sm border border-edge-subtle/60 overflow-hidden">
                          <details open={run.mode === 'raw'}>
                            <summary className="flex items-center justify-between gap-2 px-3 py-1.5 bg-surface-raised/50 cursor-pointer select-none hover:bg-surface-overlay/20 motion-safe:transition-colors group">
                              <span className="text-3xs font-mono text-fg-faint group-hover:text-fg-muted transition-colors">
                                ▸ SQL
                              </span>
                              <CopyButton value={run.result.sql} label="Copy SQL" />
                            </summary>
                            <pre className="px-3 py-2.5 text-2xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap bg-surface-root/40 border-t border-edge-subtle/40 max-h-56 leading-relaxed">
                              {run.result.sql}
                            </pre>
                          </details>
                        </div>
                      </>
                    )}
                  </Card>
                )
              })}
            </div>
          ) : (
            queryMode === 'nl' ? (
              <PromptLibrary
                onInsert={(p) => setQuestion(p)}
                onRun={(p) => { setQuestion(p); handleSubmit(p, 'nl') }}
              />
            ) : (
              <ContainedBlock tone="muted" className="py-4 text-center">
                <p className="text-2xs italic text-fg-muted">
                  Write a SQL query above and press <Kbd>⌘↵</Kbd> or click Run.
                </p>
              </ContainedBlock>
            )
          )}
        </div>
        )}

        <div className={`space-y-3 ${activeTab === 'history' ? '' : 'self-start'}`}>
          <Section title="Library">
            <SegmentedControl<SidebarTab>
              value={sidebarTab}
              onChange={setSidebarTab}
              ariaLabel="Switch between saved, recent, and team queries"
              size="sm"
              options={[
                { id: 'saved', label: 'Saved', count: saved.length },
                { id: 'recent', label: 'Recent', count: recent.length },
                { id: 'team', label: 'Team', count: team.length },
              ]}
              className="w-full justify-between"
            />

            <div className="mt-2">
              {sidebarTab === 'saved' && (
                <>
                  {historyLoading ? (
                    <ul className="space-y-1.5" aria-busy="true" aria-label="Loading saved">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <li key={i} className="space-y-1">
                          <Skeleton className="h-3 w-full" /><Skeleton className="h-2 w-1/3" />
                        </li>
                      ))}
                    </ul>
                  ) : saved.length === 0 ? (
                    <EmptySectionMessage
                      text="No saved queries yet"
                      hint="Pin a query (☆) and it shows up here for quick rerun."
                    />
                  ) : (
                    <ul className="space-y-1.5" data-dav-anchor="query:decide">
                      {saved.map((h) => (
                        <HistoryItem key={h.id} row={h} onRerun={() => handleSubmit(h.prompt, h.mode ?? 'nl')} onToggleSave={() => toggleSaved(h)} onDelete={() => setPendingDeleteHistory(h)} />
                      ))}
                    </ul>
                  )}
                </>
              )}

              {sidebarTab === 'recent' && (
                <>
                  {historyLoading ? (
                    <ul className="space-y-1.5" aria-busy="true" aria-label="Loading recent">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <li key={i} className="space-y-1">
                          <Skeleton className="h-3 w-full" /><Skeleton className="h-2 w-1/3" />
                        </li>
                      ))}
                    </ul>
                  ) : historyError ? (
                    <ErrorAlert message={`Could not load history: ${historyError}`} onRetry={loadHistory} />
                  ) : recent.length === 0 ? (
                    <EmptySectionMessage
                      text="No recent queries"
                      hint="Ask a question — the prompt + row count land here."
                    />
                  ) : (
                    <ul className="space-y-1.5 max-h-[28rem] overflow-y-auto -mr-1 pr-1" data-dav-anchor="query:verify">
                      {recent.map((h) => (
                        <HistoryItem key={h.id} row={h} onRerun={() => handleSubmit(h.prompt, h.mode ?? 'nl')} onToggleSave={() => toggleSaved(h)} onDelete={() => setPendingDeleteHistory(h)} />
                      ))}
                    </ul>
                  )}
                </>
              )}

              {sidebarTab === 'team' && (
                <>
                  {teamLoading ? (
                    <ul className="space-y-1.5" aria-busy="true" aria-label="Loading team queries">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <li key={i} className="space-y-1">
                          <Skeleton className="h-3 w-full" /><Skeleton className="h-2 w-1/3" />
                        </li>
                      ))}
                    </ul>
                  ) : teamError ? (
                    <ErrorAlert message={`Could not load team queries: ${teamError}`} onRetry={loadTeam} />
                  ) : team.length === 0 ? (
                    <EmptySectionMessage
                      text="No team queries shared"
                      hint="When a teammate pins a query in their console it shows up here."
                    />
                  ) : (
                    <ul className="space-y-1.5 max-h-[28rem] overflow-y-auto -mr-1 pr-1">
                      {team.map((row) => (
                        <TeamItem key={row.id} row={row} onRerun={() => handleSubmit(row.prompt, row.mode ?? 'nl')} />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </Section>
        </div>
      </div>
      </>
      )}

      {pendingDeleteHistory && (
        <ConfirmDialog
          title="Remove this query from history?"
          body={
            pendingDeleteHistory.is_saved
              ? 'This query is in your saved list. Removing it deletes both the saved bookmark and the run history. The original results are not stored — re-run to fetch them again.'
              : 'The history entry and its results will be deleted. Saved queries are not affected. You can always paste the prompt back in to re-run it.'
          }
          confirmLabel="Remove"
          cancelLabel="Keep"
          tone="danger"
          loading={deletingHistory}
          onConfirm={() => void confirmDeleteHistory()}
          onCancel={() => {
            if (!deletingHistory) setPendingDeleteHistory(null)
          }}
        />
      )}
    </div>
  )
}
