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
 */

import type { CiCompare, CiCompareRow, Provenance } from '../../lib/ciCompareTypes'
import { costText, formatMinutes, formatMoney, formatPercent, groupRowsByRepo, runsOnText, type RepoCostGroup } from '../../lib/ciCompareView'
import { formatSeconds } from '../../lib/ciView'
import { DataTableCell, DataTableHead } from '../ui'
import { IconCloud, IconServer, IconServerOff } from '../icons'
import { RepoVisibilityBadge } from './RepoVisibilityBadge'

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

function WideTable({ groups, fields }: { groups: RepoCostGroup[]; fields: CiCompare['fields'] }) {
  const prov = (k: string): Provenance => fields[k] ?? 'measured'
  return (
    <div className="hidden overflow-x-auto md:block">
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
        {groups.map((g) => (
          <tbody key={g.repo} className="divide-y divide-edge-subtle border-b border-edge">
            <tr className="bg-surface-overlay/40">
              <th scope="rowgroup" colSpan={6} className="px-3 py-1.5 text-left font-normal">
                <RepoHeading group={g} />
              </th>
              <td className="px-3 py-1.5 text-right text-2xs text-fg-muted tabular-nums">{formatMoney(g.monthCost, g.currency)}</td>
            </tr>
            {g.rows.map((r) => (
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
          </tbody>
        ))}
      </table>
    </div>
  )
}

function PhoneList({ groups }: { groups: RepoCostGroup[] }) {
  return (
    <ul className="flex flex-col gap-3 md:hidden" data-testid="ci-compare-cards">
      {groups.map((g) => (
        <li key={g.repo} className="rounded-md border border-edge-subtle p-2.5">
          <RepoHeading group={g} />
          <ul className="mt-2 flex flex-col divide-y divide-edge-subtle">
            {g.rows.map((r) => (
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
        </li>
      ))}
    </ul>
  )
}

export function CiCompareTable({ data }: { data: Pick<CiCompare, 'rows' | 'repos' | 'fields'> }) {
  const groups = groupRowsByRepo(data)
  if (groups.length === 0) return <p className="text-xs text-fg-muted">No CI jobs in this window, so there is nothing to compare yet.</p>
  return (
    <>
      <WideTable groups={groups} fields={data.fields} />
      <PhoneList groups={groups} />
    </>
  )
}
