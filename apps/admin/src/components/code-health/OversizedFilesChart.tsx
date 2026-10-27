/**
 * FILE: apps/admin/src/components/code-health/OversizedFilesChart.tsx
 * PURPOSE: Code size's picture: one horizontal bar per large file, longest
 *          first, against the line budget. A bar past the budget line is red,
 *          one close to it amber. Plain markup (no canvas), so it fits a
 *          390 px screen: the file name sits above its bar.
 */

const DEFAULT_BUDGET = 2000

interface OversizedFile {
  id: string
  path: string
  lines: number
}

/** Longest first; the scale leaves room past the budget line. */
function scaleMax(files: readonly OversizedFile[], budget: number): number {
  const longest = files.reduce((m, f) => Math.max(m, f.lines), 0)
  return Math.max(longest, Math.round(budget * 1.25))
}

function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

export function OversizedFilesChart({
  files,
  budget = DEFAULT_BUDGET,
  limit = 12,
}: {
  files: readonly OversizedFile[]
  budget?: number
  limit?: number
}) {
  if (files.length === 0) return null
  const sorted = [...files].sort((a, b) => b.lines - a.lines)
  const shown = sorted.slice(0, limit)
  const max = scaleMax(shown, budget)
  const budgetPct = (budget / max) * 100
  return (
    <figure className="m-0 space-y-2" data-testid="oversized-files-chart">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-2xs text-fg-muted">
        <span>Lines per file, longest first</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-px border-l border-dashed border-fg-muted" />
          {budget.toLocaleString()}-line budget
        </span>
      </figcaption>
      <ul className="list-none space-y-2 p-0">
        {shown.map((f) => {
          const over = f.lines >= budget
          const pct = Math.min(100, (f.lines / max) * 100)
          return (
            <li key={f.id} className="min-w-0" data-over={over ? 'true' : 'false'}>
              <div className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-mono text-fg" title={f.path}>
                  {fileName(f.path)}
                </span>
                <span className={`shrink-0 tabular-nums ${over ? 'font-semibold text-danger' : 'text-warn'}`}>
                  {f.lines.toLocaleString()} lines
                </span>
              </div>
              <div className="relative mt-1 h-2 w-full rounded-sm bg-surface-overlay" aria-hidden="true">
                <div className={`h-2 rounded-sm ${over ? 'bg-danger' : 'bg-warn'}`} style={{ width: `${pct}%` }} />
                <div
                  className="absolute -top-0.5 h-3 border-l border-dashed border-fg-muted"
                  style={{ left: `${budgetPct}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
      {sorted.length > shown.length ? (
        <p className="text-2xs text-fg-faint">{sorted.length - shown.length} more files are listed below.</p>
      ) : null}
    </figure>
  )
}
