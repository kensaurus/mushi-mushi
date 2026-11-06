/**
 * FILE: apps/admin/src/components/ci/CiCompareTable.tsx
 * PURPOSE: /ci "Cost and speed": one row per repo × where it ran
 *          (GitHub-hosted, your machine, never picked up), grouped by repo
 *          with its visibility (ADR 0037). Every column says whether it is
 *          MEASURED (GitHub's job times) or ESTIMATED (prices, rounding, your
 *          figures); the row count each figure comes from is shown.
 *
 *          Wide screens: a table. Phones: one card per repo with the same
 *          figures as a list, so nothing scrolls sideways.
 *
 *          Capped by default (2026-11-06): with All apps and one-job runners
 *          that do not group (`nuc12-oneoff-kus102-5`), every runner was its
 *          own row: 251 rows, about 43,000 px of the page. A repo shows its
 *          busiest few rows plus every row that needs attention (never picked
 *          up, expired jobs); the rest open with "Show N more". The most
 *          expensive repos show first; the others open the same way.
 */

import { useState } from 'react'
import type { CiCompare, CiCompareRow, Provenance } from '../../lib/ciCompareTypes'
import { costText, formatMinutes, formatMoney, formatPercent, groupRowsByRepo, runsOnText, type RepoCostGroup } from '../../lib/ciCompareView'
import { formatSeconds } from '../../lib/ciView'
import { Btn, DataTableCell, DataTableHead } from '../ui'
import { IconCloud, IconServer, IconServerOff } from '../icons'
import { RepoVisibilityBadge } from './RepoVisibilityBadge'

/** @internal Exported for the cap test. Rows a repo shows before "Show N more" (rows that need attention always show). */
export const COMPARE_ROWS_PER_REPO = 4
/** Repos shown before "Show N more repositories". */
const COMPARE_REPOS_SHOWN = 8

/** A row someone must act on: jobs nobody picked up, or jobs that expired unpicked. */
function needsAttention(row: CiCompareRow): boolean {
  return row.runnerClass === 'unknown' || row.expired > 0
}

/** @internal Exported for the cap test. The rows a collapsed repo shows, in their original order, and how many it hides. */
export function visibleCompareRows(rows: CiCompareRow[], expanded: boolean, limit = COMPARE_ROWS_PER_REPO): { rows: CiCompareRow[]; hidden: number } {
  if (expanded || rows.length <= limit) return { rows, hidden: 0 }
  const keep = new Set<CiCompareRow>()
  for (const r of rows) {
    if (keep.size >= limit) break
    if (!needsAttention(r)) keep.add(r)
  }
  for (const r of rows) if (needsAttention(r)) keep.add(r)
  const shown = rows.filter((r) => keep.has(r))
  return { rows: shown, hidden: rows.length - shown.length }
}

function useExpandedRepos() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (repo: string) =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(repo)) next.delete(repo)
      else next.add(repo)
      return next
    })
  return { open, toggle }
}

function MoreRowsButton({ hidden, expanded, onToggle }: { hidden: number; expanded: boolean; onToggle: () => void }) {
  if (!expanded && hidden === 0) return null
  return (
    <Btn size="sm" variant="ghost" onClick={onToggle} aria-expanded={expanded}>
      {expanded ? 'Show fewer runners' : `Show ${hidden} more runner${hidden === 1 ? '' : 's'}`}
    </Btn>
  )
}

const PROVENANCE: Record<Provenance, { short: string; title: string; className: string }> = {
  measured: { short: 'measured', title: 'Measured from the job times GitHub reported.', className: 'text-fg-muted' },
  estimated: { short: 'estimated', title: 'Estimated from GitHub’s list prices, its rounding rule, your plan and your electricity figures.', className: 'text-warn-foreground' },
}

function Prov({ kind }: { kind: Provenance }) {
  const p = PROVENANCE[kind]
  return (
    <span className={`block text-2xs font-normal normal-case tracking-normal ${p.className}`} title={p.title}>
      {p.short}
    </span>
  )
}

function ClassIcon({ row }: { row: CiCompareRow }) {
  if (row.runnerClass === 'github_hosted') return <IconCloud size={14} className="shrink-0 text-info" />
  if (row.runnerClass === 'self_hosted') return <IconServer size={14} className="shrink-0 text-brand" />
  return <IconServerOff size={14} className="shrink-0 text-warn-foreground" />
}

function RunsOn({ row }: { row: CiCompareRow }) {
  const t = runsOnText(row)
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <ClassIcon row={row} />
      <span className="min-w-0">
        <span className="block font-medium text-fg">{t.title}</span>
        {t.detail && <span className="block wrap-break-word font-mono text-2xs text-fg-muted">{t.detail}</span>}
        {row.expired > 0 && <span className="block text-2xs text-warn-foreground">{row.expired} expired after 24 h unpicked</span>}
      </span>
    </span>
  )
}

function Cost({ row }: { row: CiCompareRow }) {
  const c = costText(row)
  return (
    <span title={c.note} className="tabular-nums">
      <span className={row.costBasis === 'github_public_free' ? 'font-medium text-ok' : 'font-medium text-fg'}>{c.text}</span>
      <span className="sr-only"> ({c.note})</span>
    </span>
  )
}

function RepoHeading({ group }: { group: RepoCostGroup }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-mono text-xs font-semibold text-fg">{group.repo}</span>
      <RepoVisibilityBadge visibility={group.visibility} />
      {group.projectName && <span className="text-2xs text-fg-muted">{group.projectName}</span>}
    </span>
  )
}

function WideTable({ groups, fields, expanded }: { groups: RepoCostGroup[]; fields: CiCompare['fields']; expanded: ReturnType<typeof useExpandedRepos> }) {
  const prov = (k: string): Provenance => fields[k] ?? 'measured'
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full text-xs" data-testid="ci-compare-table">
        <caption className="sr-only">CI cost and speed per repository and where its jobs ran</caption>
        <thead>
          <tr className="border-b border-edge-subtle">
            <DataTableHead>Runs on</DataTableHead>
            <DataTableHead align="right">Jobs<Prov kind="measured" /></DataTableHead>
            <DataTableHead align="right">Wait p95<Prov kind={prov('queueP95s')} /></DataTableHead>
            <DataTableHead align="right">Run time p50<Prov kind={prov('runP50s')} /></DataTableHead>
            <DataTableHead align="right">PR pass rate<Prov kind={prov('prPassRate')} /></DataTableHead>
            <DataTableHead align="right">Minutes billed<Prov kind={prov('billedMinutes')} /></DataTableHead>
            <DataTableHead align="right">Per month<Prov kind={prov('monthCost')} /></DataTableHead>
          </tr>
        </thead>
        {groups.map((g) => {
          const isOpen = expanded.open.has(g.repo)
          const view = visibleCompareRows(g.rows, isOpen)
          return (
          <tbody key={g.repo} className="divide-y divide-edge-subtle border-b border-edge">
            <tr className="bg-surface-overlay/40">
              <th scope="rowgroup" colSpan={6} className="px-3 py-1.5 text-left font-normal">
                <RepoHeading group={g} />
              </th>
              <td className="px-3 py-1.5 text-right text-2xs text-fg-muted tabular-nums">{formatMoney(g.monthCost, g.currency)}</td>
            </tr>
            {view.rows.map((r) => (
              <tr key={r.key} data-testid={`ci-compare-row-${r.key}`}>
                <DataTableCell>
                  <RunsOn row={r} />
                </DataTableCell>
                <DataTableCell align="right" className="tabular-nums">{r.jobs.toLocaleString('en-US')}</DataTableCell>
                <DataTableCell align="right" className="tabular-nums">{formatSeconds(r.queueP95s)}</DataTableCell>
                <DataTableCell align="right" className="tabular-nums">{formatSeconds(r.runP50s)}</DataTableCell>
                <DataTableCell align="right" className="tabular-nums">
                  <span title={`${r.prJobs} pull-request jobs`}>{formatPercent(r.prPassRate)}</span>
                </DataTableCell>
                <DataTableCell align="right" className="tabular-nums">
                  <span title={`${r.rawMinutes} minutes of run time; GitHub rounds each job up to a whole minute`}>{formatMinutes(r.billedMinutes)}</span>
                </DataTableCell>
                <DataTableCell align="right">
                  <Cost row={r} />
                </DataTableCell>
              </tr>
            ))}
            {(view.hidden > 0 || isOpen) && (
              <tr>
                <td colSpan={7} className="px-3 py-1">
                  <MoreRowsButton hidden={view.hidden} expanded={isOpen} onToggle={() => expanded.toggle(g.repo)} />
                </td>
              </tr>
            )}
          </tbody>
          )
        })}
      </table>
    </div>
  )
}

function PhoneList({ groups, expanded }: { groups: RepoCostGroup[]; expanded: ReturnType<typeof useExpandedRepos> }) {
  return (
    <ul className="flex flex-col gap-3 lg:hidden" data-testid="ci-compare-cards">
      {groups.map((g) => {
        const isOpen = expanded.open.has(g.repo)
        const view = visibleCompareRows(g.rows, isOpen)
        return (
        <li key={g.repo} className="rounded-md border border-edge-subtle p-2.5">
          <RepoHeading group={g} />
          <ul className="mt-2 flex flex-col divide-y divide-edge-subtle">
            {view.rows.map((r) => (
              <li key={r.key} className="py-2">
                <RunsOn row={r} />
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
                  <dt className="text-fg-muted">Jobs (measured)</dt>
                  <dd className="text-right tabular-nums text-fg">{r.jobs}</dd>
                  <dt className="text-fg-muted">Wait p95 (measured)</dt>
                  <dd className="text-right tabular-nums text-fg">{formatSeconds(r.queueP95s)}</dd>
                  <dt className="text-fg-muted">Run time p50 (measured)</dt>
                  <dd className="text-right tabular-nums text-fg">{formatSeconds(r.runP50s)}</dd>
                  <dt className="text-fg-muted">PR pass rate (measured)</dt>
                  <dd className="text-right tabular-nums text-fg">{formatPercent(r.prPassRate)}</dd>
                  <dt className="text-fg-muted">Minutes billed (estimated)</dt>
                  <dd className="text-right tabular-nums text-fg">{formatMinutes(r.billedMinutes)}</dd>
                  <dt className="text-fg-muted">Per month (estimated)</dt>
                  <dd className="text-right">
                    <Cost row={r} />
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
          <MoreRowsButton hidden={view.hidden} expanded={isOpen} onToggle={() => expanded.toggle(g.repo)} />
        </li>
        )
      })}
    </ul>
  )
}

export function CiCompareTable({ data }: { data: Pick<CiCompare, 'rows' | 'repos' | 'fields'> }) {
  const groups = groupRowsByRepo(data)
  const expanded = useExpandedRepos()
  const [allRepos, setAllRepos] = useState(false)
  if (groups.length === 0) return <p className="text-xs text-fg-muted">No CI jobs in this window, so there is nothing to compare yet.</p>
  const shown = allRepos ? groups : groups.slice(0, COMPARE_REPOS_SHOWN)
  const hiddenRepos = groups.length - shown.length
  return (
    <>
      <WideTable groups={shown} fields={data.fields} expanded={expanded} />
      <PhoneList groups={shown} expanded={expanded} />
      {(hiddenRepos > 0 || allRepos) && (
        <div className="mt-2">
          <Btn size="sm" variant="ghost" onClick={() => setAllRepos((v) => !v)} aria-expanded={allRepos} data-testid="ci-compare-more-repos">
            {allRepos ? 'Show fewer repositories' : `Show ${hiddenRepos} more repositor${hiddenRepos === 1 ? 'y' : 'ies'}`}
          </Btn>
        </div>
      )}
    </>
  )
}
