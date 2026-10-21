/**
 * FILE: apps/admin/src/components/ci/ciMapLayout.ts
 * PURPOSE: Pure builder for the /ci runner map (Plan 022 Phase 4):
 *          CiOverview → React Flow nodes + edges, left to right
 *          machines → runners → repos → live jobs.
 *
 * Rules:
 * - A runner attaches to the machine whose heartbeat lists it (or its
 *   `hostId`); runners with no heartbeat attach to one "Unknown machine".
 * - GitHub-hosted runners collapse into one "GitHub-hosted" machine with one
 *   "GitHub-hosted runners" runner, so its edges never cross behind a
 *   self-hosted runner card on the way to a repo.
 * - `lastJobAt` is the newest job start Mushi holds for the runner, from the
 *   runner list or from jobs; without Administration: read it is the only
 *   sign of life the console has.
 * - Live jobs are the waiting and running ones, oldest first, at most
 *   `maxJobs`; an edge into a running job carries traveling dots.
 * - dagre (rankdir LR) orders nodes to cut crossings; each column is then
 *   stacked on its own so a node never overlaps another, even one dagre
 *   ranked wrongly because it has no edges.
 */

import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import type { CiHost, CiJob, CiOverview, CiPlatform, CiRunnerKind } from '../../lib/ciTypes'
import { buildCiQueue, jobOutcome } from '../../lib/ciView'
import { GITHUB_HOST_ID, GITHUB_RUNNERS_NAME, UNKNOWN_HOST_ID } from './ciMapContext'

type CiMapNodeKind = 'host' | 'runner' | 'repo' | 'job'


interface Base extends Record<string, unknown> {
  kind: CiMapNodeKind
  title: string
}

export interface CiHostNodeData extends Base {
  kind: 'host'
  /** `machine` = a heartbeat host; `unknown` = runners with no heartbeat; `github` = GitHub's own runners. */
  variant: 'machine' | 'unknown' | 'github'
  hostId: string | null
  platform: CiPlatform | null
  stale: boolean
  cpuCount: number | null
  memUsedMb: number | null
  memTotalMb: number | null
  swapUsedMb: number | null
  swapTotalMb: number | null
  load1: number | null
  lastHeartbeatAt: string | null
  runnerCount: number
}

export interface CiRunnerNodeData extends Base {
  kind: 'runner'
  name: string
  status: 'online' | 'offline' | 'unknown'
  busy: boolean
  runnerKind: CiRunnerKind
  repos: string[]
  labels: string[]
  restarts: number | null
  oomKills: number | null
  memCurrentMb: number | null
  memMaxMb: number | null
  jobs24h: number
  infraFailures7d: number
  /** Newest job this runner ran; the only liveness signal without Administration: read. */
  lastJobAt: string | null
}

export interface CiRepoNodeData extends Base {
  kind: 'repo'
  repo: string
  projectName: string | null
  queued: number
  running: number
  queueP95s: number | null
  passRate: number | null
}

export interface CiJobNodeData extends Base {
  kind: 'job'
  jobId: string
  repo: string
  running: boolean
  runnerName: string | null
  createdAt: string
  startedAt: string | null
  prNumber: number | null
}

type CiMapNodeData = CiHostNodeData | CiRunnerNodeData | CiRepoNodeData | CiJobNodeData

export interface CiMapEdgeData extends Record<string, unknown> {
  running: boolean
}

/** @internal Exported for tests only. */
export const CI_NODE_SIZE: Record<CiMapNodeKind, { width: number; height: number }> = {
  host: { width: 232, height: 124 },
  runner: { width: 216, height: 104 },
  repo: { width: 216, height: 88 },
  job: { width: 216, height: 64 },
}

const COLUMN: Record<CiMapNodeKind, number> = { host: 0, runner: 1, repo: 2, job: 3 }
const COLUMN_GAP = 96
const ROW_GAP = 16

export interface CiMap {
  nodes: Node<CiMapNodeData>[]
  edges: Edge<CiMapEdgeData>[]
  width: number
  height: number
}

function hostOfRunner(hosts: CiHost[], name: string, hostId: string | null): CiHost | null {
  if (hostId) {
    const byId = hosts.find((h) => h.hostId === hostId)
    if (byId) return byId
  }
  return hosts.find((h) => h.runners.some((r) => r.name === name)) ?? null
}

function nodeId(kind: CiMapNodeKind, key: string): string {
  return `${kind}:${key}`
}

/** Build the map. `maxJobs` caps the live-jobs column. */
export function buildCiMap(overview: CiOverview, opts: { maxJobs?: number; now?: number } = {}): CiMap {
  const maxJobs = opts.maxJobs ?? 20
  const now = opts.now ?? Date.now()
  const nodes = new Map<string, CiMapNodeData>()
  const edges = new Map<string, Edge<CiMapEdgeData>>()

  const addEdge = (source: string, target: string, running = false) => {
    const id = `${source}->${target}`
    const prior = edges.get(id)
    if (prior) {
      if (running && !prior.data?.running) prior.data = { running: true }
      return
    }
    edges.set(id, { id, source, target, type: 'ciEdge', data: { running } })
  }

  // Repos first, so runners and jobs can link to them.
  const repoNode = (repo: string): string => {
    const id = nodeId('repo', repo)
    if (!nodes.has(id)) {
      const r = overview.repos.find((x) => x.repo === repo)
      nodes.set(id, {
        kind: 'repo',
        title: repo,
        repo,
        projectName: r?.projectName ?? null,
        queued: r?.queued ?? 0,
        running: r?.running ?? 0,
        queueP95s: r?.queueP95s ?? null,
        passRate: r?.passRate ?? null,
      })
    }
    return id
  }
  for (const r of overview.repos) repoNode(r.repo)

  // Machines with a heartbeat.
  for (const h of overview.hosts) {
    nodes.set(nodeId('host', h.hostId), {
      kind: 'host',
      title: h.hostname,
      variant: 'machine',
      hostId: h.hostId,
      platform: h.platform,
      stale: h.stale,
      cpuCount: h.cpuCount,
      memUsedMb: h.metrics.memUsedMb ?? null,
      memTotalMb: h.memTotalMb,
      swapUsedMb: h.metrics.swapUsedMb ?? null,
      swapTotalMb: h.metrics.swapTotalMb ?? null,
      load1: h.metrics.load1 ?? null,
      lastHeartbeatAt: h.lastHeartbeatAt,
      runnerCount: 0,
    })
  }

  const specialHost = (variant: 'unknown' | 'github'): string => {
    const id = variant === 'unknown' ? UNKNOWN_HOST_ID : GITHUB_HOST_ID
    if (!nodes.has(id)) {
      nodes.set(id, {
        kind: 'host',
        title: variant === 'unknown' ? 'Unknown machine' : 'GitHub-hosted',
        variant,
        hostId: null,
        platform: null,
        stale: false,
        cpuCount: null,
        memUsedMb: null,
        memTotalMb: null,
        swapUsedMb: null,
        swapTotalMb: null,
        load1: null,
        lastHeartbeatAt: null,
        runnerCount: 0,
      })
    }
    return id
  }

  // Which runner is running a job in which repo right now.
  const runningOn = new Set<string>()
  for (const j of overview.jobs) {
    if (j.runnerName && jobOutcome(j) === 'running') runningOn.add(`${j.runnerName}\u0000${j.repo}`)
  }

  // Runners, merged by name across the repos they serve.
  type Acc = { name: string; repos: Set<string>; labels: Set<string>; status: CiRunnerNodeData['status']; busy: boolean; kind: CiRunnerKind; hostId: string | null; jobs24h: number; infra7d: number; lastJobAt: string | null }
  const runners = new Map<string, Acc>()
  const touch = (name: string, kind: CiRunnerKind, hostId: string | null): Acc => {
    let acc = runners.get(name)
    if (!acc) {
      acc = { name, repos: new Set(), labels: new Set(), status: 'unknown', busy: false, kind, hostId, jobs24h: 0, infra7d: 0, lastJobAt: null }
      runners.set(name, acc)
    }
    if (acc.kind === 'unknown' && kind !== 'unknown') acc.kind = kind
    if (!acc.hostId && hostId) acc.hostId = hostId
    return acc
  }
  for (const r of overview.runners) {
    const acc = touch(r.name, r.kind, r.hostId)
    acc.repos.add(r.repo)
    for (const l of r.labels) acc.labels.add(l)
    if (r.status === 'online' || (r.status === 'offline' && acc.status === 'unknown')) acc.status = r.status
    acc.busy = acc.busy || r.busy === true
    acc.jobs24h += r.jobs24h
    acc.infra7d += r.infraFailures7d
    if (r.lastJobAt && (!acc.lastJobAt || r.lastJobAt > acc.lastJobAt)) acc.lastJobAt = r.lastJobAt
  }
  // Runners known only from a heartbeat.
  for (const h of overview.hosts) {
    for (const hr of h.runners) {
      const acc = touch(hr.name, 'self_hosted', h.hostId)
      if (hr.repo) acc.repos.add(hr.repo)
    }
  }
  // Runners seen only on jobs.
  for (const j of overview.jobs) {
    if (!j.runnerName) continue
    const acc = touch(j.runnerName, j.runnerKind, null)
    acc.repos.add(j.repo)
    const at = j.startedAt ?? j.createdAt
    if (!acc.lastJobAt || at > acc.lastJobAt) acc.lastJobAt = at
  }

  // GitHub-hosted runners are one node in the runner column, so every edge
  // goes machine -> runner -> repo and none crosses behind a runner card.
  const ghRunnerId = nodeId('runner', GITHUB_RUNNERS_NAME)
  for (const acc of runners.values()) {
    if (acc.kind === 'github_hosted') {
      const gh = specialHost('github')
      const existing = nodes.get(ghRunnerId) as CiRunnerNodeData | undefined
      const busyHere = [...acc.repos].some((repo) => runningOn.has(`${acc.name}\u0000${repo}`))
      const merged: CiRunnerNodeData = existing ?? {
        kind: 'runner',
        title: GITHUB_RUNNERS_NAME,
        name: GITHUB_RUNNERS_NAME,
        status: 'online',
        busy: false,
        runnerKind: 'github_hosted',
        repos: [],
        labels: [],
        restarts: null,
        oomKills: null,
        memCurrentMb: null,
        memMaxMb: null,
        jobs24h: 0,
        infraFailures7d: 0,
        lastJobAt: null,
      }
      merged.busy = merged.busy || busyHere
      merged.repos = [...new Set([...merged.repos, ...acc.repos])].sort()
      merged.labels = [...new Set([...merged.labels, ...acc.labels])].sort()
      merged.jobs24h += acc.jobs24h
      merged.infraFailures7d += acc.infra7d
      if (acc.lastJobAt && (!merged.lastJobAt || acc.lastJobAt > merged.lastJobAt)) merged.lastJobAt = acc.lastJobAt
      if (!existing) {
        nodes.set(ghRunnerId, merged)
        ;(nodes.get(gh) as CiHostNodeData).runnerCount += 1
      }
      addEdge(gh, ghRunnerId, merged.busy)
      for (const repo of acc.repos) addEdge(ghRunnerId, repoNode(repo), runningOn.has(`${acc.name}\u0000${repo}`))
      continue
    }
    const host = hostOfRunner(overview.hosts, acc.name, acc.hostId)
    const hostNodeId = host ? nodeId('host', host.hostId) : specialHost('unknown')
    const hostData = nodes.get(hostNodeId) as CiHostNodeData
    hostData.runnerCount += 1
    const hr = host?.runners.find((r) => r.name === acc.name) ?? null
    const id = nodeId('runner', acc.name)
    const busy = acc.busy || [...acc.repos].some((repo) => runningOn.has(`${acc.name}\u0000${repo}`))
    nodes.set(id, {
      kind: 'runner',
      title: acc.name,
      name: acc.name,
      // A heartbeat that reports the service down outranks "unknown".
      status: acc.status === 'unknown' && hr ? (hr.active ? 'online' : 'offline') : acc.status,
      busy,
      runnerKind: acc.kind,
      repos: [...acc.repos].sort(),
      labels: [...acc.labels].sort(),
      restarts: hr?.restarts ?? null,
      oomKills: hr?.oomKills ?? null,
      memCurrentMb: hr?.memCurrentMb ?? null,
      memMaxMb: hr?.memMaxMb ?? null,
      jobs24h: acc.jobs24h,
      infraFailures7d: acc.infra7d,
      lastJobAt: acc.lastJobAt,
    })
    addEdge(hostNodeId, id, busy)
    for (const repo of acc.repos) addEdge(id, repoNode(repo), runningOn.has(`${acc.name}\u0000${repo}`))
  }

  // Live jobs: waiting + running, oldest first.
  const queue = buildCiQueue(overview.jobs, now)
  const live: CiJob[] = [...queue.running, ...queue.waiting]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, maxJobs)
  for (const j of live) {
    const running = jobOutcome(j) === 'running'
    const id = nodeId('job', j.id)
    nodes.set(id, {
      kind: 'job',
      title: j.jobName,
      jobId: j.id,
      repo: j.repo,
      running,
      runnerName: j.runnerName,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      prNumber: j.prNumber,
    })
    addEdge(repoNode(j.repo), id, running)
  }

  return layout(nodes, [...edges.values()])
}

function layout(data: Map<string, CiMapNodeData>, edges: Edge<CiMapEdgeData>[]): CiMap {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: ROW_GAP, ranksep: COLUMN_GAP })
  g.setDefaultEdgeLabel(() => ({}))
  for (const [id, d] of data) g.setNode(id, { ...CI_NODE_SIZE[d.kind] })
  for (const e of edges) g.setEdge(e.source, e.target)
  dagre.layout(g)

  // Stack each column in dagre's vertical order.
  const columns: string[][] = [[], [], [], []]
  for (const [id, d] of data) columns[COLUMN[d.kind]].push(id)
  const dagreY = (id: string) => (g.node(id) as { y?: number } | undefined)?.y ?? 0
  const heights = columns.map((ids) =>
    ids.reduce((sum, id) => sum + CI_NODE_SIZE[data.get(id)!.kind].height, 0) + Math.max(0, ids.length - 1) * ROW_GAP,
  )
  const height = Math.max(0, ...heights)
  const colX: number[] = []
  let x = 0
  for (let c = 0; c < 4; c++) {
    colX.push(x)
    const widest = Math.max(0, ...columns[c].map((id) => CI_NODE_SIZE[data.get(id)!.kind].width))
    if (widest > 0) x += widest + COLUMN_GAP
  }

  const nodes: Node<CiMapNodeData>[] = []
  columns.forEach((ids, c) => {
    ids.sort((a, b) => dagreY(a) - dagreY(b) || a.localeCompare(b))
    let y = (height - heights[c]) / 2
    for (const id of ids) {
      const d = data.get(id)!
      const size = CI_NODE_SIZE[d.kind]
      nodes.push({
        id,
        type: `ci-${d.kind}`,
        position: { x: colX[c], y },
        width: size.width,
        height: size.height,
        draggable: false,
        connectable: false,
        data: d,
      })
      y += size.height + ROW_GAP
    }
  })

  return { nodes, edges, width: Math.max(0, x - COLUMN_GAP), height }
}
