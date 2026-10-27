/**
 * FILE: apps/admin/src/lib/workers.ts
 * PURPOSE: Local workers (`mushi work --daemon`, ADR 0048) for the console:
 *          the read model of GET /v1/admin/work/lanes and the writes the
 *          Workers tab and "Send to my local worker" make. The server holds
 *          each lane's settings; the machine reads them at its next heartbeat
 *          (within a minute), so every change here is a value, never a command.
 */

import { apiFetch } from './supabase'

export const LANES_PATH = '/v1/admin/work/lanes'
const KEY_PATH = '/v1/admin/work/key'

type LaneMode = 'fix' | 'followups' | 'conflicts' | 'audit' | 'skill'

/** What each mode does, as the Workers tab offers it (ADR 0048; P3: 0049, 0050, 0042 amendment). */
export const LANE_MODES: ReadonlyArray<{ value: LaneMode; label: string; hint: string }> = [
  { value: 'fix', label: 'Fix reports and follow-ups', hint: 'Takes its queue first, then the worst open reports, and opens a draft PR for each.' },
  { value: 'followups', label: 'Review follow-ups only', hint: 'Fixes what Opus asked for on PRs a local agent opened.' },
  { value: 'conflicts', label: 'Resolve merge conflicts', hint: "Merges the base branch into PRs of this clone's repository that wait in the merge queue. The agent may change only the conflicted files; anything else is refused." },
  { value: 'audit', label: 'Audit the code, screen by screen', hint: 'A model proposes bugs; the machine files only those its own check reproduces. A fix lane for the same app on this machine gets them.' },
  { value: 'skill', label: 'Run skill runs', hint: 'Takes only the rounds of skill runs started on /credits with this lane.' },
]

export interface LaneConfig {
  paused: boolean
  concurrency: number
  model: string | null
  mode: LaneMode
  stop_at: string | null
  drain: boolean
  prune_own: boolean
}

export interface HostGuards {
  max_agents: number
  min_free_mem_gb: number
  gh_floor: number
}

export interface WorkerHost {
  id: string
  hostname: string
  platform: string
  version: string | null
  online: boolean
  lastHeartbeatAt: string
  status: Record<string, string | number>
  guards: HostGuards
  revoked: boolean
  mine: boolean
}

export interface WorkerLane {
  id: string
  hostId: string
  projectId: string
  projectName: string
  name: string
  config: LaneConfig
  /** Audit lanes: the model that may veto a reproduced finding; null = no veto pass. */
  reviewModel?: string | null
  /** owner/name of the lane's clone, as the machine reports it. */
  repo?: string | null
  status: Record<string, string | number>
  lastSeenAt: string
  /** A conflict or audit run holds no report (reportId null). */
  active: Array<{ claimId: string; kind?: ClaimKind; reportId: string | null; title: string; since: string; leaseUntil: string; fromQueue: boolean }>
  queue: Array<{ reportId: string; title: string; severity: string | null; status: string | null; source: string; position: number }>
  recent: Array<{
    claimId: string
    kind?: ClaimKind
    reportId: string | null
    title: string
    outcome: string | null
    failureKind: 'infra' | 'code' | null
    prUrl: string | null
    detail: string | null
    claimedAt: string
    finishedAt: string | null
    autoRequeued: boolean
  }>
  counts7d: { runs: number; prs: number; merges?: number; filed?: number; noChange: number; timeouts: number; errors: number; infra: number }
}

type ClaimKind = 'fix' | 'conflict' | 'audit'

export interface WorkLanesData {
  generatedAt: string
  projects: Array<{ id: string; name: string }>
  hosts: WorkerHost[]
  lanes: WorkerLane[]
}

/** The same model id rule as the server and the daemon: letters, digits and `._:-`. */
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

/** A lane takes new reports: its machine is online, it is not paused or draining, before its stop date, fixing reports. */
export function laneTaking(lane: WorkerLane, host: WorkerHost | undefined, now: number = Date.now()): boolean {
  const c = lane.config
  if (!host || !host.online || host.revoked) return false
  if (c.paused || c.drain || c.mode !== 'fix') return false
  return !(c.stop_at && Date.parse(c.stop_at) <= now)
}

/**
 * The lanes this user can send reports to for one app: on their own,
 * unrevoked machines, in a mode that takes reports from its queue. A bug
 * report goes to a `fix` lane; a skill run may also use a `skill` lane.
 */
export function myLanesFor(data: WorkLanesData | null | undefined, projectId: string, modes: readonly LaneMode[] = ['fix']): WorkerLane[] {
  if (!data || !Array.isArray(data.lanes) || !Array.isArray(data.hosts)) return []
  const mine = new Set(data.hosts.filter((h) => h.mine && !h.revoked).map((h) => h.id))
  return data.lanes.filter((l) => l.projectId === projectId && mine.has(l.hostId) && modes.includes(l.config.mode))
}

/** The 7-day line under a lane's name, in the words of what its mode does. */
export function laneCountsLine(lane: Pick<WorkerLane, 'config' | 'counts7d'>): string {
  const n = lane.counts7d
  const errors = `${n.timeouts} timed out, ${n.errors} errors${n.infra > 0 ? ` (${n.infra} the machine's fault)` : ''}`
  if (lane.config.mode === 'conflicts') return `${n.runs} conflicts tried, ${n.merges ?? 0} merged in, ${errors} in 7 days`
  if (lane.config.mode === 'audit') return `${n.runs} screens read, ${n.filed ?? 0} with findings filed, ${errors} in 7 days`
  return `${n.runs} runs, ${n.prs} PRs, ${errors} in 7 days`
}

/** One sentence on how the workers stand, and the three numbers that matter. */
export function workersSummary(data: WorkLanesData, now: number = Date.now()) {
  const hosts = new Map(data.hosts.map((h) => [h.id, h]))
  const online = data.hosts.filter((h) => h.online && !h.revoked).length
  const taking = data.lanes.filter((l) => laneTaking(l, hosts.get(l.hostId), now)).length
  const queued = data.lanes.reduce((n, l) => n + l.queue.length, 0)
  const offlineWithQueue = data.lanes.filter((l) => l.queue.length > 0 && !hosts.get(l.hostId)?.online).length
  let tone: 'ok' | 'warn' | 'neutral' = 'neutral'
  let sentence: string
  if (data.hosts.length === 0) sentence = 'No local worker is set up yet.'
  else if (offlineWithQueue > 0) {
    tone = 'warn'
    sentence = `${offlineWithQueue} lane${offlineWithQueue === 1 ? ' has' : 's have'} reports waiting, but ${offlineWithQueue === 1 ? 'its machine is' : 'their machines are'} offline.`
  } else if (online === 0) {
    tone = 'warn'
    sentence = 'Every worker is offline: nothing is being fixed on your machines.'
  } else {
    tone = 'ok'
    sentence = `${online} worker${online === 1 ? '' : 's'} online; ${taking} lane${taking === 1 ? '' : 's'} taking reports.`
  }
  return { sentence, tone, online, taking, queued }
}

/** "3 min", "2 h": since a time, for heartbeats and runs. */
export function sinceLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never'
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

export const OUTCOME_LABEL: Record<string, string> = {
  pr_opened: 'Opened a PR',
  no_change: 'No change',
  verdict: 'Agent verdict',
  timeout: 'Timed out',
  skipped: 'Skipped',
  stopped: 'Stopped',
  failed: 'Failed',
  lease_expired: 'Worker went quiet',
  pushed: 'Merged the base in',
  refused: 'Refused by its checks',
  filed: 'Filed findings',
}

export interface WriteResult {
  ok: boolean
  message: string
}

const fail = (res: { error?: { message?: string } | null }) => ({ ok: false, message: res.error?.message ?? 'The request failed.' })

/** What the console may change on a lane: the closed settings, plus an audit lane's veto model. */
export type LaneSettings = Partial<LaneConfig> & { review_model?: string | null }

/** Change one lane setting (only the verbs that changed). */
export async function patchLane(laneId: string, patch: LaneSettings): Promise<WriteResult> {
  const res = await apiFetch<{ id: string; config: LaneConfig }>(`/v1/admin/work/lanes/${encodeURIComponent(laneId)}`, {
    method: 'PATCH',
    scope: 'enumeration',
    body: JSON.stringify(patch),
  })
  return res.ok ? { ok: true, message: 'Saved. The worker picks it up within a minute.' } : fail(res)
}

/** Replace a lane's queue with this order, or append reports to its end. */
const REPORT_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Report ids in pasted text (one per line, a queue file, a list of links), in order, each once. */
export function reportIdsIn(text: string): string[] {
  return [...new Set((text.match(REPORT_ID_RE) ?? []).map((id) => id.toLowerCase()))]
}

export async function putQueue(laneId: string, reportIds: string[], append = false): Promise<WriteResult> {
  const res = await apiFetch<{ laneId: string; reportIds: string[] }>(`/v1/admin/work/lanes/${encodeURIComponent(laneId)}/queue`, {
    method: 'PUT',
    scope: 'enumeration',
    body: JSON.stringify(append ? { reportIds, append: true } : { reportIds }),
  })
  if (!res.ok) return fail(res)
  return { ok: true, message: append ? `Sent ${reportIds.length === 1 ? 'the report' : `${reportIds.length} reports`} to the lane's queue.` : 'Queue saved.' }
}

export async function patchHostGuards(hostId: string, guards: Partial<HostGuards>): Promise<WriteResult> {
  const res = await apiFetch<{ id: string; guards: HostGuards }>(`/v1/admin/work/hosts/${encodeURIComponent(hostId)}`, {
    method: 'PATCH',
    scope: 'enumeration',
    body: JSON.stringify(guards),
  })
  return res.ok ? { ok: true, message: 'Saved. The worker picks it up within a minute.' } : fail(res)
}

export async function revokeHost(hostId: string): Promise<WriteResult> {
  const res = await apiFetch<{ id: string; revoked: boolean }>(`/v1/admin/work/hosts/${encodeURIComponent(hostId)}`, { method: 'DELETE', scope: 'enumeration' })
  return res.ok ? { ok: true, message: 'Revoked. The worker stops at its next heartbeat.' } : fail(res)
}

/** A worker key (worker:run) for these apps; the key comes back once. */
export async function createWorkerKey(projectIds: string[], label: string): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  const res = await apiFetch<{ key: string }>(KEY_PATH, {
    method: 'POST',
    scope: 'enumeration',
    body: JSON.stringify({ projectIds, label }),
  })
  if (!res.ok || !res.data?.key) return { ok: false, message: res.error?.message ?? 'The key was not created.' }
  return { ok: true, key: res.data.key }
}

/** Move one item of a list up (-1) or down (+1); out of range leaves it as it is. */
export function moveItem<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by
  if (to < 0 || to >= list.length) return [...list]
  const next = [...list]
  const [x] = next.splice(index, 1)
  next.splice(to, 0, x!)
  return next
}
