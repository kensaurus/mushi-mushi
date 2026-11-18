/**
 * FILE: apps/admin/src/components/portfolio/FindingsMatrix.tsx
 * PURPOSE: "Fix once" as findings × apps (2026-11-18). It was ten cards, each a paragraph and
 *          a comma list of app names; the owner: "what is this stupid long list uiux with bad
 *          design system and text wall?". Now one row per problem: a severity mark, a title of
 *          six words at most, a dot under every app it is open in (nothing elsewhere) and ONE
 *          action that copies the fix prompt. Serious first, then by apps affected. The
 *          explanation opens under the row and is never shown by default.
 *
 * A real <table>: the app columns carry the app's icon with its name as tooltip and screen-
 * reader text, the problem cells are row headers, and each dot is named ("Fix key: glot.it").
 * It scrolls sideways inside its own box on a narrow screen, never the page.
 */

import { Fragment, useState } from 'react'
import { StatusMark, STATUS_FILL, STATUS_INK, type RunStatus } from '../signal/StatusMark'
import { ProjectFavicon } from '../ProjectFavicon'
import { CopyFixButton, type IconFor } from './AppIconChips'
import type { FixOnceRow } from '../../lib/groupAppFindings'

const SEVERITY: Record<FixOnceRow['severity'], { status: RunStatus; word: string }> = {
  error: { status: 'failed', word: 'Serious' },
  warn: { status: 'waiting', word: 'Look at' },
  info: { status: 'idle', word: 'Note' },
}

export function FindingsMatrix({ rows, appOrder, iconFor }: { rows: readonly FixOnceRow[]; appOrder: readonly string[]; iconFor: IconFor }) {
  const [open, setOpen] = useState<string | null>(null)
  // Only the apps some row touches get a column, in the page's own app order.
  const affected = new Set(rows.flatMap((r) => r.projectIds))
  const apps = [...appOrder.filter((id) => affected.has(id)), ...[...affected].filter((id) => !appOrder.includes(id))]
  const nameOf = (id: string) => iconFor(id).project_name
  return (
    // `relative`: the screen-reader-only header text is absolutely placed. Without a positioned
    // box here its containing block is outside the scroller, so the far-right "Fix" header
    // widened the whole page at 390 px (2026-11-18 preview) instead of scrolling in here.
    <div className="relative min-w-0 overflow-x-auto" data-testid="fix-once-matrix">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">Problems open in two or more apps, by app</caption>
        <thead>
          <tr className="border-b border-edge">
            <th scope="col" className="px-1.5 py-1 text-left text-2xs font-semibold text-fg-secondary">
              Problem
            </th>
            {apps.map((id) => (
              // The app's name, set vertically above its icon, so a column is never only an avatar
              // (2026-11-18 sweep). The tooltip keeps the whole name when it is cut.
              <th key={id} scope="col" className="w-7 px-0.5 py-1 align-bottom" title={nameOf(id)} data-testid={`fix-once-col-${id}`}>
                <span className="flex flex-col items-center gap-1">
                  <span className="max-h-24 truncate text-2xs font-semibold text-fg-secondary [writing-mode:vertical-rl] rotate-180" data-testid="fix-once-app-name">
                    {nameOf(id)}
                  </span>
                  <ProjectFavicon {...iconFor(id)} size={12} />
                </span>
              </th>
            ))}
            <th scope="col" className="px-1.5 py-1 text-right">
              <span className="sr-only">Fix</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sev = SEVERITY[r.severity]
            const isOpen = open === r.ruleId
            const affectedHere = new Set(r.projectIds)
            return (
              <Fragment key={r.ruleId}>
                <tr className="ci-rise border-b border-edge-subtle hover:bg-surface-overlay/60" data-testid={`fix-once-row-${r.ruleId}`} data-severity={r.severity}>
                  <th scope="row" className="max-w-72 px-1.5 py-1 text-left font-normal">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : r.ruleId)}
                      className="flex w-full min-w-0 items-center gap-1.5 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
                      title={isOpen ? 'Hide why' : 'Show why'}
                    >
                      {/* The open/close chevron leads the row, like every other disclosure: at the
                          far end it read as a column of its own (2026-11-18 sweep). */}
                      <span className="shrink-0 text-fg-muted" aria-hidden="true" data-testid="fix-once-toggle-mark">
                        {isOpen ? '▾' : '▸'}
                      </span>
                      <StatusMark status={sev.status} label={sev.word} />
                      <span className="truncate font-semibold text-fg" title={r.fullTitle}>
                        {r.title}
                      </span>
                      <span className={`shrink-0 font-mono text-2xs font-bold tabular-nums ${STATUS_INK[sev.status]}`} title={`${r.projectIds.length} apps`}>
                        {r.projectIds.length}
                        <span className="sr-only"> apps</span>
                      </span>
                    </button>
                  </th>
                  {apps.map((id) => (
                    <td key={id} className="px-0.5 py-1 text-center" data-app={id} data-affected={affectedHere.has(id) || undefined}>
                      {affectedHere.has(id) && (
                        <span
                          role="img"
                          aria-label={`${r.title}: ${nameOf(id)}`}
                          title={nameOf(id)}
                          className={`ci-pop inline-block h-2 w-2 rounded-full ${STATUS_FILL[sev.status]}`}
                          data-testid="fix-once-dot"
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1.5 py-0.5 text-right">
                    <CopyFixButton label={r.action} prompt={r.fix} apps={r.projectIds.length} />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-edge-subtle bg-surface-overlay/40" data-testid={`fix-once-detail-${r.ruleId}`}>
                    <td colSpan={apps.length + 2} className="px-1.5 py-1.5 text-xs text-fg-secondary">
                      {r.gateLabel && <span className="mr-1.5 font-semibold text-fg">{r.gateLabel}</span>}
                      <span title={r.ruleId}>{r.explanation}</span>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
