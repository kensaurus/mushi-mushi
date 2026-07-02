import { type ReactNode } from 'react'
import { ResponsiveTable } from '../ResponsiveTable'
import { InlineProof } from '../report-detail/ReportSurface'
import { CHIP_TONE } from '../../lib/chipTone'

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
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-2xs font-medium leading-none ${cls}`}>
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
      critical: CHIP_TONE.dangerSubtle + ' border border-danger/30',
      high:     CHIP_TONE.warnSubtle,
      medium:   CHIP_TONE.warnSubtle,
      low:      CHIP_TONE.infoSubtle + ' border border-info/25',
    }
    const label: Record<string, string> = { critical: 'P0 critical', high: 'P1 high', medium: 'P2 medium', low: 'P3 low' }
    return <CellBadge cls={map[strL] ?? 'bg-surface-raised text-fg-secondary border border-edge-subtle'}>{label[strL] ?? str}</CellBadge>
  }

  // Status
  if (colL === 'status') {
    const map: Record<string, string> = {
      new:        'bg-brand/10 text-brand border border-brand/25',
      pending:    CHIP_TONE.infoSubtle + ' border border-info/25',
      submitted:  CHIP_TONE.infoSubtle + ' border border-info/25',
      queued:     CHIP_TONE.infoSubtle + ' border border-info/25',
      classified: CHIP_TONE.okSubtle,
      grouped:    CHIP_TONE.okSubtle,
      fixing:     CHIP_TONE.warnSubtle,
      fixed:      CHIP_TONE.okSubtle,
      dismissed:  'bg-surface-raised text-fg-muted border border-edge-subtle',
      failed:     CHIP_TONE.dangerSubtle,
    }
    return <CellBadge cls={map[strL] ?? 'bg-surface-raised text-fg-secondary border border-edge-subtle'}>{str}</CellBadge>
  }

  // Category
  if (colL === 'category') {
    const map: Record<string, string> = {
      bug:       CHIP_TONE.dangerSubtle,
      slow:      CHIP_TONE.warnSubtle,
      visual:    CHIP_TONE.accentSubtle + ' border border-accent/25',
      confusing: CHIP_TONE.infoSubtle + ' border border-info/25',
      other:     'bg-surface-raised text-fg-muted border border-edge-subtle',
    }
    return <CellBadge cls={map[strL] ?? 'bg-surface-raised text-fg-secondary border border-edge-subtle'}>{str}</CellBadge>
  }

  // Verification status
  if (colL === 'verification_status') {
    const map: Record<string, string> = {
      passed:  CHIP_TONE.okSubtle,
      failed:  CHIP_TONE.dangerSubtle,
      pending: CHIP_TONE.infoSubtle + ' border border-info/25',
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

export function QueryResultsTable({ rows }: { rows: unknown[] }) {
  const table = asTable(rows)
  if (!table) {
    return (
      <pre className="mushi-code-block mushi-code-body p-2 rounded-sm text-2xs overflow-x-auto max-h-64 font-mono">
        {JSON.stringify(rows.slice(0, 20), null, 2)}
      </pre>
    )
  }

  // Determine alignment per column based on first non-null value
  const sampleRow = table.data[0] ?? {}
  const numericCols = new Set(table.columns.filter((c) => isNumericCol(c, sampleRow[c])))

  return (
    <>
    <ResponsiveTable ariaLabel="Query results">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-surface-raised border-b border-edge">
            {table.columns.map((c) => (
              <th
                key={c}
                className={`py-2 px-3 text-2xs font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap ${
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
              className={`border-b border-edge-subtle/50 hover:bg-surface-raised motion-safe:transition-colors ${
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
    </ResponsiveTable>
      {table.data.length > 50 && (
        <InlineProof className="mt-1.5 mx-3">
          Showing first 50 of {table.data.length} rows.
        </InlineProof>
      )}
    </>
  )
}
