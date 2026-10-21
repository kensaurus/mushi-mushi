/**
 * FILE: apps/admin/src/components/ci/CiNodeDrawer.tsx
 * PURPOSE: Details for a node clicked on the /ci runner map — the machine,
 *          runner, repository or job — in the shared StageDrawer (focus trap,
 *          Esc to close). Machines and runners show live gauges, a 7-day
 *          outcome chart and chips that open the linked machine, runner or
 *          repository, so the drawer can be walked like the map.
 */

import type { ReactNode } from 'react'
import { StageDrawer } from '../flow-primitives/StageDrawer'
import { RelativeTime } from '../ui'
import type { CiJob, CiOverview } from '../../lib/ciTypes'
import { ciActivity, formatPercent, formatSeconds } from '../../lib/ciView'
import { GITHUB_HOST_ID, GITHUB_RUNNER_ID, GITHUB_RUNNERS_NAME, UNKNOWN_HOST_ID } from './ciMapContext'
import { CiJobOutcomeChip } from './CiJobOutcomeChip'
import { ActivityBars, ChipRow, DrawerSection, Facts, Gauge, RecentJobs, StatTiles, StatusLine } from './CiDrawerParts'
import { runnerStatus } from './ciRunnerStatus'
import { MUSHI_VERIFY_JOB_NOTE, isMushiVerifyJob } from '../../lib/verifyView'

interface Props {
  overview: CiOverview
  nodeId: string | null
  onClose: () => void
  /** Open another node (a chip or a job row in the drawer). */
  onSelect?: (nodeId: string) => void
}

type Select = ((nodeId: string) => void) | undefined

const PLATFORM_LABEL: Record<string, string> = { linux: 'Linux', wsl2: 'WSL 2 on Windows', macos: 'macOS', windows: 'Windows' }

function mb(v: number | null | undefined): string {
  return v == null ? '—' : `${(v / 1024).toFixed(1)} GB`
}

function now(o: CiOverview): number {
  const t = Date.parse(o.generatedAt)
  return Number.isFinite(t) ? t : Date.now()
}

/** Map node id of the runner a job ran on. */
function runnerNodeId(j: Pick<CiJob, 'runnerName' | 'runnerKind'>): string | null {
  if (j.runnerKind === 'github_hosted') return GITHUB_RUNNER_ID
  return j.runnerName ? `runner:${j.runnerName}` : null
}

/** The activity chart, stat tiles and recent jobs every runner-like node shares. */
function JobsPanel({ o, jobs, empty, onSelect, jobsToday }: { o: CiOverview; jobs: CiJob[]; empty: string; onSelect: Select; jobsToday?: number }) {
  const oldest = o.jobs.reduce<number | null>((m, j) => {
    const t = Date.parse(j.createdAt)
    return Number.isFinite(t) && (m == null || t < m) ? t : m
  }, null)
  const a = ciActivity(jobs, now(o), 7, oldest)
  const today = a.days[a.days.length - 1]
  const finishedToday = today.passed + today.failed + today.infra + today.other
  return (
    <>
      <DrawerSection title="Performance" hint={`from the ${a.finished} most recent finished jobs Mushi holds`}>
        <StatTiles
          tiles={[
            { label: 'Jobs today', value: String(jobsToday ?? finishedToday) },
            { label: 'Pass rate', value: formatPercent(a.passRate), hint: 'of passed and failed jobs' },
            { label: 'Typical wait', value: formatSeconds(a.waitP50s), hint: 'for a machine (median)' },
            { label: 'Typical run', value: formatSeconds(a.runP50s), hint: 'median' },
          ]}
        />
      </DrawerSection>
      <DrawerSection title="Last 7 days" hint={a.days.some((d) => !d.covered) ? 'shaded days are older than the jobs Mushi holds' : undefined}>
        <ActivityBars activity={a} />
      </DrawerSection>
      <RecentJobs jobs={jobs} empty={empty} onSelect={onSelect} />
    </>
  )
}

function runnerContent(o: CiOverview, key: string, onSelect: Select) {
  if (key === GITHUB_RUNNERS_NAME) {
    const jobs = o.jobs.filter((j) => j.runnerKind === 'github_hosted')
    const repos = [...new Set(jobs.map((j) => j.repo))].sort()
    const labels = [...new Set(jobs.flatMap((j) => j.labels))].sort()
    const busy = jobs.some((j) => j.status === 'in_progress')
    const st = runnerStatus({ busy, status: 'online', runnerKind: 'github_hosted' })
    return {
      title: GITHUB_RUNNERS_NAME,
      subtitle: 'Machines GitHub starts for each job. Mushi sees their jobs, not their memory or load.',
      body: (
        <>
          <StatusLine {...st} />
          <DrawerSection title="Runs for">
            <ChipRow items={repos.map((r) => ({ key: r, label: r, nodeId: `repo:${r}` }))} onSelect={onSelect} />
          </DrawerSection>
          <DrawerSection title="Machine types asked for">
            <ChipRow items={labels.map((l) => ({ key: l, label: l }))} />
          </DrawerSection>
          <JobsPanel o={o} jobs={jobs} empty="No jobs on GitHub's machines in this window." onSelect={onSelect} />
        </>
      ),
    }
  }

  const rows = o.runners.filter((r) => r.name === key)
  const host = o.hosts.find((h) => rows.some((r) => r.hostId === h.hostId)) ?? o.hosts.find((h) => h.runners.some((r) => r.name === key)) ?? null
  const hr = host?.runners.find((r) => r.name === key) ?? null
  const jobs = o.jobs.filter((j) => j.runnerName === key)
  // Rows also come from jobs; only a known status means GitHub listed it.
  const listed = rows.some((r) => r.status !== 'unknown')
  const status = rows.some((r) => r.status === 'online') ? 'online' : rows.some((r) => r.status === 'offline') ? 'offline' : hr ? (hr.active ? 'online' : 'offline') : 'unknown'
  const busy = rows.some((r) => r.busy) || jobs.some((j) => j.status === 'in_progress')
  const st = runnerStatus({ busy, status, runnerKind: 'self_hosted' })
  const repos = [...new Set([...rows.map((r) => r.repo), ...(hr?.repo ? [hr.repo] : []), ...jobs.map((j) => j.repo)])].sort()
  const labels = [...new Set([...rows.flatMap((r) => r.labels), ...jobs.flatMap((j) => j.labels)])].sort()
  const infra7d = rows.reduce((s, r) => s + r.infraFailures7d, 0)
  const peak = jobs.reduce<number | null>((m, j) => (j.memPeakMb == null ? m : Math.max(m ?? 0, j.memPeakMb)), null)
  const lastJob = [...rows.map((r) => r.lastJobAt), ...jobs.map((j) => j.startedAt ?? j.createdAt)].filter((x): x is string => !!x).sort().pop() ?? null

  return {
    title: key,
    subtitle: host ? `On ${host.hostname}` : 'On a machine with no Mushi heartbeat',
    body: (
      <>
        <StatusLine {...st} />
        <DrawerSection title="Where it runs">
          <ChipRow
            items={[
              host
                ? { key: 'host', label: `${host.hostname} · ${PLATFORM_LABEL[host.platform] ?? host.platform}`, nodeId: `host:${host.hostId}`, dot: host.stale ? 'bg-warn' : 'bg-ok' }
                : { key: 'host', label: 'Unknown machine', nodeId: UNKNOWN_HOST_ID, dot: 'bg-fg-faint' },
              ...repos.map((r) => ({ key: r, label: r, nodeId: `repo:${r}` })),
            ]}
            onSelect={onSelect}
          />
        </DrawerSection>
        <DrawerSection title="Labels" hint="jobs ask for these in runs-on">
          <ChipRow items={labels.map((l) => ({ key: l, label: l }))} empty="No labels reported." />
        </DrawerSection>
        <DrawerSection title="Health">
          <Gauge
            label="Memory now"
            used={hr?.memCurrentMb}
            total={hr?.memMaxMb}
            note={hr ? (peak != null ? `Biggest job peak: ${mb(peak)}` : undefined) : 'Needs a Mushi heartbeat on this machine'}
          />
          <Facts
            rows={[
              ['Last job', lastJob ? <RelativeTime key="lj" value={lastJob} /> : 'None seen'],
              ['Machine stops (7 days)', String(infra7d)],
              ['Service restarts', hr?.restarts != null ? String(hr.restarts) : '—'],
              ['Out-of-memory kills', hr?.oomKills != null ? String(hr.oomKills) : '—'],
              ['Service', hr?.service ?? '—'],
              ['Listed by GitHub', listed ? 'Yes' : 'No (seen on jobs only)'],
            ]}
          />
        </DrawerSection>
        <JobsPanel o={o} jobs={jobs} empty="No recent jobs on this runner." onSelect={onSelect} jobsToday={listed ? rows.reduce((s, r) => s + r.jobs24h, 0) : undefined} />
      </>
    ),
  }
}

function hostContent(o: CiOverview, key: string, onSelect: Select) {
  const h = o.hosts.find((x) => x.hostId === key)
  if (!h) return null
  const names = new Set(h.runners.map((r) => r.name))
  const cpu = h.cpuCount ?? null
  const load = h.metrics.load1
  return {
    title: h.hostname,
    subtitle: `${PLATFORM_LABEL[h.platform] ?? h.platform}${cpu ? ` · ${cpu} CPUs` : ''}${h.mushiVersion ? ` · mushi ${h.mushiVersion}` : ''}`,
    body: (
      <>
        <StatusLine
          dot={h.stale ? 'bg-warn' : 'bg-ok'}
          word={h.stale ? 'No heartbeat lately' : 'Reporting'}
          why={h.stale ? 'The machine may be off, asleep, or its heartbeat timer stopped.' : 'Mushi gets this machine’s memory, load and runner services every few minutes.'}
        />
        <DrawerSection title="Resources" hint={<>heartbeat <RelativeTime value={h.lastHeartbeatAt} /></>}>
          <Gauge label="Memory" used={h.metrics.memUsedMb} total={h.memTotalMb} />
          <Gauge label="Swap" used={h.metrics.swapUsedMb} total={h.metrics.swapTotalMb} />
          {load != null && cpu ? (
            <Gauge label="Load (1 min) per CPU" used={load * 1024} total={cpu * 1024} note={`${load.toFixed(2)} across ${cpu} CPUs`} />
          ) : (
            <Facts rows={[['Load (1 min)', load != null ? load.toFixed(2) : '—']]} />
          )}
          <Facts rows={[['Disk free', h.metrics.diskFreeGb != null ? `${h.metrics.diskFreeGb} GB` : '—']]} />
        </DrawerSection>
        <DrawerSection title="Runners on this machine">
          <ul className="flex flex-col gap-1.5">
            {h.runners.length === 0 && <li className="text-2xs text-fg-faint">None reported.</li>}
            {h.runners.map((r) => {
              const pct = r.memCurrentMb != null && r.memMaxMb ? Math.min(100, (r.memCurrentMb / r.memMaxMb) * 100) : null
              return (
                <li key={r.name}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(`runner:${r.name}`)}
                    className="flex w-full items-center gap-2 rounded-md border border-edge-subtle bg-surface-raised px-2.5 py-1.5 text-left text-xs hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${r.active ? 'bg-ok' : 'bg-danger'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium text-fg">{r.name}</span>
                    <span className="shrink-0 text-3xs text-fg-muted">{r.active ? 'Service up' : 'Service down'}</span>
                    {pct != null && (
                      <span className="flex w-24 shrink-0 items-center gap-1 text-3xs text-fg-muted tabular-nums">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-overlay" aria-hidden="true">
                          <span className={`block h-full rounded-full ${pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
                        </span>
                        {Math.round(pct)}%
                      </span>
                    )}
                    <span aria-hidden="true" className="text-fg-faint">
                      →
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </DrawerSection>
        <JobsPanel o={o} jobs={o.jobs.filter((j) => j.runnerName && names.has(j.runnerName))} empty="No recent jobs on this machine." onSelect={onSelect} />
      </>
    ),
  }
}

function content(o: CiOverview, nodeId: string, onSelect: Select): { title: string; subtitle: string; body: ReactNode } | null {
  const [kind, ...rest] = nodeId.split(':')
  const key = rest.join(':')

  if (nodeId === GITHUB_HOST_ID) {
    const jobs = o.jobs.filter((j) => j.runnerKind === 'github_hosted')
    return {
      title: 'GitHub-hosted',
      subtitle: 'Machines GitHub runs for you. Mushi sees their jobs, not their memory or load.',
      body: (
        <>
          <ChipRow items={[{ key: 'r', label: GITHUB_RUNNERS_NAME, nodeId: GITHUB_RUNNER_ID }]} onSelect={onSelect} />
          <JobsPanel o={o} jobs={jobs} empty="No jobs on GitHub's machines in this window." onSelect={onSelect} />
        </>
      ),
    }
  }
  if (nodeId === UNKNOWN_HOST_ID) {
    const known = new Set(o.hosts.flatMap((h) => h.runners.map((r) => r.name)))
    const names = new Set(
      [
        ...o.runners.filter((r) => r.kind !== 'github_hosted' && !o.hosts.some((h) => h.hostId === r.hostId)).map((r) => r.name),
        ...o.jobs.filter((j) => j.runnerKind !== 'github_hosted' && j.runnerName).map((j) => j.runnerName!),
      ].filter((n) => !known.has(n)),
    )
    return {
      title: 'Unknown machine',
      subtitle: 'These runners have not sent a heartbeat, so Mushi cannot see their memory or service state.',
      body: (
        <>
          <p className="text-xs text-fg-secondary">
            On the machine that hosts them, run <code className="font-mono">mushi runner key</code>, then{' '}
            <code className="font-mono">mushi runner hooks install --dir &lt;runner dir&gt;</code>, to fill this in.
          </p>
          <DrawerSection title="Runners">
            <ChipRow items={[...names].sort().map((n) => ({ key: n, label: n, nodeId: `runner:${n}` }))} onSelect={onSelect} empty="None." />
          </DrawerSection>
          <JobsPanel o={o} jobs={o.jobs.filter((j) => j.runnerName && names.has(j.runnerName))} empty="No recent jobs on these runners." onSelect={onSelect} />
        </>
      ),
    }
  }
  if (kind === 'host') return hostContent(o, key, onSelect)
  if (kind === 'runner') return runnerContent(o, key, onSelect)
  if (kind === 'repo') {
    const r = o.repos.find((x) => x.repo === key)
    const jobs = o.jobs.filter((j) => j.repo === key)
    const runnerIds = new Map<string, string>()
    for (const j of jobs) {
      const id = runnerNodeId(j)
      if (id) runnerIds.set(id, j.runnerKind === 'github_hosted' ? GITHUB_RUNNERS_NAME : j.runnerName!)
    }
    for (const x of o.runners.filter((x) => x.repo === key)) runnerIds.set(x.kind === 'github_hosted' ? GITHUB_RUNNER_ID : `runner:${x.name}`, x.kind === 'github_hosted' ? GITHUB_RUNNERS_NAME : x.name)
    return {
      title: key,
      subtitle: r?.projectName ? `App: ${r.projectName}` : 'Repository',
      body: (
        <>
          <StatTiles
            tiles={[
              { label: 'Waiting now', value: String(r?.queued ?? 0) },
              { label: 'Running now', value: String(r?.running ?? 0) },
              { label: 'Slow wait', value: formatSeconds(r?.queueP95s), hint: '1 job in 20 waits longer' },
              { label: 'Typical run', value: formatSeconds(r?.durationP50s), hint: 'median' },
            ]}
          />
          <DrawerSection title="Runs on">
            <ChipRow items={[...runnerIds].map(([id, label]) => ({ key: id, label, nodeId: id }))} onSelect={onSelect} empty="No runner seen yet." />
          </DrawerSection>
          <JobsPanel o={o} jobs={jobs} empty="No recent jobs in this repository." onSelect={onSelect} />
        </>
      ),
    }
  }
  if (kind === 'job') {
    const j = o.jobs.find((x) => x.id === key)
    if (!j) return null
    const runnerId = runnerNodeId(j)
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
              ['Asked for', (j.labels ?? []).join(', ') || '—'],
              ['Queued', <RelativeTime key="q" value={j.createdAt} />],
              ['Waited', formatSeconds(j.queueSeconds)],
              ['Ran', formatSeconds(j.durationSeconds)],
              ['Memory peak', j.memPeakMb != null ? mb(j.memPeakMb) : '—'],
            ]}
          />
          <DrawerSection title="Ran on">
            <ChipRow
              items={[
                ...(runnerId ? [{ key: 'runner', label: j.runnerKind === 'github_hosted' ? `${GITHUB_RUNNERS_NAME}${j.runnerName ? ` (${j.runnerName})` : ''}` : j.runnerName!, nodeId: runnerId }] : []),
                { key: 'repo', label: j.repo, nodeId: `repo:${j.repo}` },
              ]}
              onSelect={onSelect}
            />
          </DrawerSection>
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

export function CiNodeDrawer({ overview, nodeId, onClose, onSelect }: Props) {
  const c = nodeId ? content(overview, nodeId, onSelect) : null
  return (
    <StageDrawer open={c != null} onClose={onClose} title={c?.title ?? ''} subtitle={c?.subtitle}>
      {c?.body}
    </StageDrawer>
  )
}
