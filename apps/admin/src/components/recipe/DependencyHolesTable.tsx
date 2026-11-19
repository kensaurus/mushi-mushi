/**
 * FILE: apps/admin/src/components/recipe/DependencyHolesTable.tsx
 * PURPOSE: Known holes in the app's dependencies as one compact table (owner, 2026-11-19):
 *          package, installed → fixed version, the hole count as a bar, and the row's own
 *          fix. "Fix in a PR" opens the bug report vuln-watch filed for that upgrade, where
 *          the Fix button opens the pull request; a row with no report yet copies its prompt.
 *          Rows past the first ten sit behind "Show N more".
 */

import { useState } from 'react'
import { Btn } from '../ui'
import { BarCell, type BarTone } from '../signal/BarCell'
import { StatusGlyph, type SignalTone } from '../signal/StatusGlyph'
import { CopyPromptButton } from '../gates/CopyFixPromptButton'
import { fixAllHolesPrompt, type HoleRow, type HoleSeverity } from './dependencyHoles'

const SHOWN = 10

const SEVERITY_TONE: Record<HoleSeverity, { glyph: SignalTone; bar: BarTone; word: string }> = {
  critical: { glyph: 'danger', bar: 'danger', word: 'Critical' },
  high: { glyph: 'danger', bar: 'danger', word: 'High' },
  medium: { glyph: 'warn', bar: 'warn', word: 'Medium' },
  low: { glyph: 'off', bar: 'neutral', word: 'Low' },
  info: { glyph: 'off', bar: 'neutral', word: 'Dev only' },
}

export function DependencyHolesTable({ rows }: { rows: readonly HoleRow[] }) {
  const [all, setAll] = useState(false)
  if (rows.length === 0) return null
  const max = Math.max(...rows.map((r) => r.holes))
  const shown = all ? rows : rows.slice(0, SHOWN)
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="dependency-holes-table">
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="text-left text-2xs font-semibold text-fg-secondary">
              <th scope="col" className="py-1 pr-2">Package</th>
              <th scope="col" className="py-1 pr-2">Version → fixed in</th>
              <th scope="col" className="py-1 pr-2">Holes</th>
              <th scope="col" className="py-1 text-right">
                <span className="sr-only">Fix</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const sev = SEVERITY_TONE[r.severity]
              return (
                <tr key={r.key} className={r.dev ? 'text-fg-secondary' : ''} data-testid="dependency-hole-row">
                  <th scope="row" className="max-w-48 border-t border-edge-subtle py-1 pr-2 text-left font-normal">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <StatusGlyph tone={sev.glyph} label={sev.word} />
                      <span className="truncate font-mono font-bold text-fg" title={r.where.join(', ') || undefined}>{r.name}</span>
                      {r.exploited && (
                        <span className="shrink-0 rounded-sm border border-danger/50 bg-danger-muted px-1 text-3xs font-bold text-danger-foreground" title="On CISA's list of holes attackers already use">
                          EXPLOITED
                        </span>
                      )}
                      {r.dev && <span className="shrink-0 text-3xs text-fg-muted">dev only</span>}
                    </span>
                  </th>
                  <td className="border-t border-edge-subtle py-1 pr-2 font-mono whitespace-nowrap tabular-nums">
                    <span className="text-fg-secondary">{r.installed}</span>
                    <span className="px-1 text-fg-muted" aria-hidden="true">→</span>
                    <span className="sr-only"> fixed in </span>
                    {r.target ? <span className="font-bold text-ok-foreground">{r.target}</span> : <span className="text-fg-muted">no fix yet</span>}
                  </td>
                  <td className="border-t border-edge-subtle py-1 pr-2">
                    <BarCell value={r.holes} max={max} tone={sev.bar} text={r.holes} widthClass="w-14" />
                  </td>
                  <td className="border-t border-edge-subtle py-1 text-right whitespace-nowrap">
                    {r.reportId ? (
                      <Btn size="sm" variant="ghost" to={`/reports/${r.reportId}`} title="Open its bug report: the Fix button there opens a pull request with this upgrade">
                        Fix in a PR →
                      </Btn>
                    ) : r.target ? (
                      <CopyPromptButton text={fixAllHolesPrompt([r])} label="Copy prompt" title={`Copy a prompt that upgrades ${r.name} to ${r.target}`} testId="copy-hole-prompt" />
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN && (
        <button type="button" className="self-start text-2xs text-fg-secondary underline hover:text-fg" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show ${rows.length - SHOWN} more`}
        </button>
      )}
    </div>
  )
}
