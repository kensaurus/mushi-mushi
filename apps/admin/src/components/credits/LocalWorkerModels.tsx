/**
 * FILE: apps/admin/src/components/credits/LocalWorkerModels.tsx
 * PURPOSE: /credits "Local workers: models": the model each local worker
 *          lane runs (ADR 0048), beside the Cursor keys' spend-down, so the
 *          credits a lane spends are on the same page as the cloud keys'.
 *          The model is a lane setting held by Mushi (ADR 0039), changed on
 *          the Workers tab. When no local agent has worked for 2 hours while
 *          Cursor credits expire within 7 days, it says so first, with what
 *          blocks the work (the `credits_idle` worker flag, ADR 0048
 *          amendment 2026-10-28).
 */

import { Link } from 'react-router-dom'
import { Badge, Btn, Callout } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { LANES_PATH, laneTaking, type WorkerLane, type WorkLanesData } from '../../lib/workers'
import { StatusGlyph } from '../signal/StatusGlyph'

type LaneNow = 'taking' | 'paused' | 'offline'
const NOW_WORD: Record<LaneNow, string> = { taking: 'taking reports', paused: 'paused or draining', offline: 'offline' }

/**
 * @internal Exported for tests. Offline lanes grouped by machine: 19 rows that
 * all said "offline" with the same model are one "▲ 19 lanes offline
 * (alienwarex16)" line, opened per app (fresh-eyes 2026-11-18).
 */
export function groupOfflineLanes(
  lanes: readonly WorkerLane[],
  nowOf: (l: WorkerLane) => LaneNow,
  hostName: (hostId: string) => string,
): { live: WorkerLane[]; offline: Array<{ host: string; lanes: WorkerLane[] }> } {
  const live: WorkerLane[] = []
  const byHost = new Map<string, WorkerLane[]>()
  for (const l of lanes) {
    if (nowOf(l) !== 'offline') {
      live.push(l)
      continue
    }
    const host = hostName(l.hostId)
    byHost.set(host, [...(byHost.get(host) ?? []), l])
  }
  return { live, offline: [...byHost.entries()].map(([host, ls]) => ({ host, lanes: ls })) }
}

export function LocalWorkerModels() {
  const page = usePageData<WorkLanesData>(LANES_PATH, { scope: 'enumeration' })
  const data = page.data
  if (!data || !Array.isArray(data.lanes)) {
    return page.loading ? <p className="text-xs text-fg-muted">Reading your local workers…</p> : null
  }
  if (data.lanes.length === 0) {
    return (
      <p className="text-xs text-fg-muted" data-testid="credits-worker-models-empty">
        No local worker lane yet. A worker runs <code>mushi work --daemon</code> on your machine with your own Cursor account;{' '}
        <Link className="text-brand underline underline-offset-2" to="/pipeline?tab=workers">
          set one up
        </Link>
        .
      </p>
    )
  }
  const hosts = new Map(data.hosts.map((h) => [h.id, h]))
  const nowOf = (l: WorkerLane): LaneNow =>
    laneTaking(l, hosts.get(l.hostId)) ? 'taking' : hosts.get(l.hostId)?.online ? 'paused' : 'offline'
  const { live, offline } = groupOfflineLanes(data.lanes, nowOf, (id) => hosts.get(id)?.hostname ?? 'unknown machine')
  // The out-of-credits flag (id credits_out) is shown at the top of the page with its remedy.
  const idle = (data.flags ?? []).find((f) => f.kind === 'credits_idle' && f.id !== 'credits_out')
  return (
    <div className="space-y-2" data-testid="credits-worker-models">
      {idle && (
        <Callout
          tone={idle.severity}
          label="Credits idle"
          action={
            <Btn size="sm" variant={idle.severity === 'danger' ? 'danger' : 'ghost'} to="/pipeline?tab=workers" data-testid="credits-idle-open">
              Open Workers
            </Btn>
          }
        >
          <div data-testid="credits-idle">
            <p className="text-sm font-semibold text-fg">{idle.title}.</p>
            <p className="text-xs text-fg-secondary">{idle.cause}</p>
          </div>
        </Callout>
      )}
      {/* Problems first: each machine's offline lanes are one line, opened per app. */}
      {offline.map((g) => (
        <details key={g.host} className="group rounded-sm" data-testid="credits-offline-lanes">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 py-1 text-xs text-fg hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
            <StatusGlyph tone="danger" />
            <span className="font-semibold">
              {g.lanes.length} {g.lanes.length === 1 ? 'lane' : 'lanes'} offline
            </span>
            <span className="min-w-0 truncate font-mono text-2xs text-fg-secondary">({g.host})</span>
          </summary>
          <LaneTable lanes={g.lanes} nowOf={nowOf} />
        </details>
      ))}
      {live.length > 0 && <LaneTable lanes={live} nowOf={nowOf} />}
      <Link className="text-2xs font-medium text-brand underline underline-offset-2" to="/pipeline?tab=workers">
        Change models and lanes on the Workers tab →
      </Link>
    </div>
  )
}

function LaneTable({ lanes, nowOf }: { lanes: readonly WorkerLane[]; nowOf: (l: WorkerLane) => LaneNow }) {
  return (
    <div className="overflow-x-auto">
      {/* Model drops out on a phone so "Now" stays on screen (it was cut off at 390px). */}
      <table className="w-full text-left text-xs sm:min-w-120">
        <thead className="text-2xs text-fg-muted">
          <tr className="border-b border-edge-subtle">
            <th className="py-1.5 pr-3 font-medium">App</th>
            <th className="py-1.5 pr-3 font-medium">Lane</th>
            <th className="hidden py-1.5 pr-3 font-medium sm:table-cell">Model</th>
            <th className="py-1.5 pr-3 font-medium">Now</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge-subtle">
          {lanes.map((l) => {
            const now = nowOf(l)
            return (
              <tr key={l.id} data-testid={`credits-worker-model-${l.id}`}>
                <td className="py-1.5 pr-3 text-fg">{l.projectName}</td>
                <td className="py-1.5 pr-3 font-mono text-fg-secondary">{l.name}</td>
                <td className="hidden py-1.5 pr-3 font-mono text-fg-secondary sm:table-cell">{l.config.model ?? 'agent default'}</td>
                <td className="py-1.5 pr-3">
                  <Badge tone={now === 'taking' ? 'ok' : 'neutral'} className="whitespace-nowrap">{NOW_WORD[now]}</Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
