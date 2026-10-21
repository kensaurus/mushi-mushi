/**
 * FILE: apps/admin/src/components/ci/CiNodeDrawer.tsx
 * PURPOSE: Details for a node clicked on the /ci runner map — the machine,
 *          runner, repository or job, and its recent jobs — in the shared
 *          StageDrawer (focus trap, Esc to close).
 */

import type { ReactNode } from 'react'
import { StageDrawer } from '../flow-primitives/StageDrawer'
import { RelativeTime } from '../ui'
import type { CiJob, CiOverview } from '../../lib/ciTypes'
import { formatPercent, formatSeconds } from '../../lib/ciView'
import { GITHUB_HOST_ID, UNKNOWN_HOST_ID } from './ciMapContext'
import { CiJobOutcomeChip } from './CiJobOutcomeChip'
import { MUSHI_VERIFY_JOB_NOTE, isMushiVerifyJob } from '../../lib/verifyView'

interface Props {
  overview: CiOverview
  nodeId: string | null
  onClose: () => void
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="flex flex-col gap-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3">
          <dt className="w-40 shrink-0 text-fg-muted">{k}</dt>
          <dd className="min-w-0 text-fg tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function RecentJobs({ jobs, empty }: { jobs: CiJob[]; empty: string }) {
  const recent = [...jobs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 10)
  return (
    <section className="mt-4 flex flex-col gap-1.5" aria-label="Recent jobs">
      <h4 className="text-xs font-semibold text-fg">Recent jobs</h4>
      {recent.length === 0 ? (
        <p className="text-xs text-fg-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge-subtle">
          {recent.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-xs">
              <CiJobOutcomeChip job={j} />
              <span className="min-w-0 truncate font-medium text-fg">{j.jobName}</span>
              <span className="text-fg-faint">{j.repo}</span>
              <span className="ml-auto text-fg-muted tabular-nums">{formatSeconds(j.durationSeconds)}</span>
              {j.htmlUrl && (
                <a href={j.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  GitHub ↗
                </a>
              )}
              {j.infraDetail && <p className="w-full text-2xs text-fg-muted">{j.infraDetail}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function mb(v: number | null | undefined): string {
  return v == null ? '—' : `${(v / 1024).toFixed(1)} GB`
}

function content(o: CiOverview, nodeId: string): { title: string; subtitle: string; body: ReactNode } | null {
  const [kind, ...rest] = nodeId.split(':')
  const key = rest.join(':')

  if (nodeId === GITHUB_HOST_ID) {
    const jobs = o.jobs.filter((j) => j.runnerKind === 'github_hosted')
    return {
      title: 'GitHub-hosted',
      subtitle: 'Machines GitHub runs for you. Mushi sees their jobs, not their memory or load.',
      body: <RecentJobs jobs={jobs} empty="No jobs on GitHub's machines in this window." />,
    }
  }
  if (nodeId === UNKNOWN_HOST_ID) {
    const known = new Set(o.hosts.flatMap((h) => h.runners.map((r) => r.name)))
    const names = new Set(o.runners.filter((r) => r.kind !== 'github_hosted' && !known.has(r.name) && !o.hosts.some((h) => h.hostId === r.hostId)).map((r) => r.name))
    return {
      title: 'Unknown machine',
      subtitle: 'These runners have not sent a heartbeat, so Mushi cannot see their memory or service state.',
      body: (
        <>
          <p className="text-xs text-fg-secondary">
            On the machine that hosts them, run <code className="font-mono">mushi runner key</code>, then{' '}
            <code className="font-mono">mushi runner hooks install --dir &lt;runner dir&gt;</code>, to fill this in.
          </p>
          <RecentJobs jobs={o.jobs.filter((j) => j.runnerName && names.has(j.runnerName))} empty="No recent jobs on these runners." />
        </>
      ),
    }
  }
  if (kind === 'host') {
    const h = o.hosts.find((x) => x.hostId === key)
    if (!h) return null
    const names = new Set(h.runners.map((r) => r.name))
    return {
      title: h.hostname,
      subtitle: h.stale ? 'No heartbeat lately: the machine may be off or the heartbeat timer stopped.' : 'A machine that runs your tests.',
      body: (
        <>
          <Facts
            rows={[
              ['System', `${h.platform}${h.cpuCount ? `, ${h.cpuCount} CPUs` : ''}`],
              ['Memory', `${mb(h.metrics.memUsedMb)} of ${mb(h.memTotalMb)}`],
              ['Swap', `${mb(h.metrics.swapUsedMb)} of ${mb(h.metrics.swapTotalMb)}`],
              ['Load (1 min)', h.metrics.load1 != null ? h.metrics.load1.toFixed(2) : '—'],
              ['Disk free', h.metrics.diskFreeGb != null ? `${h.metrics.diskFreeGb} GB` : '—'],
              ['Last heartbeat', <RelativeTime key="hb" value={h.lastHeartbeatAt} />],
              ['Runners', h.runners.map((r) => `${r.name}${r.active ? '' : ' (stopped)'}`).join(', ') || 'None reported'],
            ]}
          />
          <RecentJobs jobs={o.jobs.filter((j) => j.runnerName && names.has(j.runnerName))} empty="No recent jobs on this machine." />
        </>
      ),
    }
  }
  if (kind === 'runner') {
    const rows = o.runners.filter((r) => r.name === key)
    const hr = o.hosts.flatMap((h) => h.runners).find((r) => r.name === key)
    const online = rows.some((r) => r.status === 'online')
    const busy = rows.some((r) => r.busy)
    return {
      title: key,
      subtitle: busy ? 'Running a job now.' : online ? 'Online and idle.' : rows.length ? 'Offline or not seen by GitHub.' : 'Seen only on jobs.',
      body: (
        <>
          <Facts
            rows={[
              ['Repositories', [...new Set(rows.map((r) => r.repo).concat(hr?.repo ? [hr.repo] : []))].join(', ') || '—'],
              ['Labels', [...new Set(rows.flatMap((r) => r.labels))].join(', ') || '—'],
              ['Jobs today', String(rows.reduce((s, r) => s + r.jobs24h, 0))],
              ['Machine stops (7 days)', String(rows.reduce((s, r) => s + r.infraFailures7d, 0))],
              ['Service restarts', hr?.restarts != null ? String(hr.restarts) : '—'],
              ['Out-of-memory kills', hr?.oomKills != null ? String(hr.oomKills) : '—'],
              ['Memory now / cap', `${mb(hr?.memCurrentMb)} / ${mb(hr?.memMaxMb)}`],
            ]}
          />
          <RecentJobs jobs={o.jobs.filter((j) => j.runnerName === key)} empty="No recent jobs on this runner." />
        </>
      ),
    }
  }
  if (kind === 'repo') {
    const r = o.repos.find((x) => x.repo === key)
    return {
      title: key,
      subtitle: r?.projectName ? `App: ${r.projectName}` : 'Repository',
      body: (
        <>
          <Facts
            rows={[
              ['Waiting now', String(r?.queued ?? 0)],
              ['Running now', String(r?.running ?? 0)],
              ['Jobs (window)', String(r?.jobs7d ?? 0)],
              ['Pass rate', formatPercent(r?.passRate)],
              ['Wait for a machine (p95)', formatSeconds(r?.queueP95s)],
              ['Run time (median)', formatSeconds(r?.durationP50s)],
            ]}
          />
          <RecentJobs jobs={o.jobs.filter((j) => j.repo === key)} empty="No recent jobs in this repository." />
        </>
      ),
    }
  }
  if (kind === 'job') {
    const j = o.jobs.find((x) => x.id === key)
    if (!j) return null
    return {
      title: j.jobName,
      subtitle: `${j.repo}${j.workflowName ? ` · ${j.workflowName}` : ''}`,
      body: (
        <>
          <Facts
            rows={[
              ['State', <CiJobOutcomeChip key="s" job={j} />],
              ['Pull request', j.prNumber ? `#${j.prNumber}` : '—'],
              ['Branch', j.headBranch ?? '—'],
              ['Runner', j.runnerName ?? 'None yet'],
              ['Asked for', (j.labels ?? []).join(', ') || '—'],
              ['Queued', <RelativeTime key="q" value={j.createdAt} />],
              ['Waited', formatSeconds(j.queueSeconds)],
              ['Ran', formatSeconds(j.durationSeconds)],
              ['Memory peak', j.memPeakMb != null ? mb(j.memPeakMb) : '—'],
            ]}
          />
          {j.infraDetail && <p className="mt-3 text-xs text-fg-secondary">{j.infraDetail}</p>}
          {isMushiVerifyJob(j) && <p className="mt-3 text-xs text-fg-secondary">{MUSHI_VERIFY_JOB_NOTE}</p>}
          {j.htmlUrl && (
            <a href={j.htmlUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
              Open on GitHub ↗
            </a>
          )}
        </>
      ),
    }
  }
  return null
}

export function CiNodeDrawer({ overview, nodeId, onClose }: Props) {
  const c = nodeId ? content(overview, nodeId) : null
  return (
    <StageDrawer open={c != null} onClose={onClose} title={c?.title ?? ''} subtitle={c?.subtitle}>
      {c?.body}
    </StageDrawer>
  )
}
