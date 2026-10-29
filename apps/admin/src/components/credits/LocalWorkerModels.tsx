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
import { LANES_PATH, laneTaking, type WorkLanesData } from '../../lib/workers'

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
        <Link className="text-brand hover:underline" to="/pipeline?tab=workers">
          set one up
        </Link>
        .
      </p>
    )
  }
  const hosts = new Map(data.hosts.map((h) => [h.id, h]))
  const idle = (data.flags ?? []).find((f) => f.kind === 'credits_idle')
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-120 text-left text-xs">
          <thead className="text-2xs text-fg-muted">
            <tr className="border-b border-edge-subtle">
              <th className="py-1.5 pr-3 font-medium">App</th>
              <th className="py-1.5 pr-3 font-medium">Lane</th>
              <th className="py-1.5 pr-3 font-medium">Model</th>
              <th className="py-1.5 pr-3 font-medium">Now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge-subtle">
            {data.lanes.map((l) => {
              const taking = laneTaking(l, hosts.get(l.hostId))
              return (
                <tr key={l.id} data-testid={`credits-worker-model-${l.id}`}>
                  <td className="py-1.5 pr-3 text-fg">{l.projectName}</td>
                  <td className="py-1.5 pr-3 font-mono text-fg-secondary">{l.name}</td>
                  <td className="py-1.5 pr-3 font-mono text-fg-secondary">{l.config.model ?? 'agent default'}</td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={taking ? 'ok' : 'neutral'}>{taking ? 'taking reports' : hosts.get(l.hostId)?.online ? 'paused or draining' : 'offline'}</Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Link className="text-2xs font-medium text-brand hover:underline" to="/pipeline?tab=workers">
        Change models and lanes on the Workers tab →
      </Link>
    </div>
  )
}
