/**
 * FILE: apps/admin/src/components/pipeline/FixOpeners.tsx
 * PURPOSE: Who opens fix PRs, per app: the server's dispatcher (spend-down on
 *          an active Cursor key, ADR 0028), with its keys, last dispatch and
 *          dispatches in 24 h; local `mushi work` lanes, with their last run;
 *          or nobody. An app whose auto-fix is on but cannot dispatch is red
 *          and links to the switch that fixes it.
 *
 *          2026-10-26: every app showed auto-fix "on" while the server had
 *          dispatched nothing for 48 h, because its only Cursor key was off.
 */

import { Link } from 'react-router-dom'
import { Badge } from '../ui'
import { ageLabel, type DispatcherStatus } from '../../lib/pipeline'

interface Props {
  dispatchers: DispatcherStatus[]
  now: number
}

const OPENER: Record<DispatcherStatus['opener'], { label: string; tone: 'ok' | 'info' | 'neutral' | 'warn' }> = {
  both: { label: 'Server + local', tone: 'ok' },
  server: { label: 'Server', tone: 'info' },
  local: { label: 'Local lanes', tone: 'info' },
  nobody: { label: 'Nobody', tone: 'warn' },
}

function since(iso: string | null, now: number): string {
  return iso ? `${ageLabel(iso, now)} ago` : 'never (7 d)'
}

export function FixOpeners({ dispatchers, now }: Props) {
  if (dispatchers.length === 0) return null
  const rows = [...dispatchers].sort((a, b) => Number(!!b.problem) - Number(!!a.problem) || a.name.localeCompare(b.name))
  return (
    <div className="overflow-x-auto" data-testid="pipeline-openers">
      <table className="w-full min-w-[40rem] text-left text-2xs">
        <thead className="text-fg-muted">
          <tr className="border-b border-edge-subtle">
            <th className="py-1.5 pr-3 font-medium">App</th>
            <th className="py-1.5 pr-3 font-medium">Opens fixes (7 d)</th>
            <th className="py-1.5 pr-3 font-medium">Server auto-fix</th>
            <th className="py-1.5 pr-3 font-medium">Local mushi work</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge-subtle">
          {rows.map((d) => (
            <tr key={d.projectId} className={d.problem ? 'bg-danger-muted/25' : ''} data-testid={`pipeline-opener-${d.projectId}`}>
              <td className="py-1.5 pr-3 align-top font-medium text-fg">{d.name}</td>
              <td className="py-1.5 pr-3 align-top">
                <Badge tone={OPENER[d.opener].tone}>{OPENER[d.opener].label}</Badge>
              </td>
              <td className="py-1.5 pr-3 align-top text-fg-secondary">
                <span className="block">
                  {d.autofixOn ? 'On' : 'Off'} · {d.server.agentKeys} agent key{d.server.agentKeys === 1 ? '' : 's'}
                  {d.server.offKeys > 0 && <span className="text-fg-muted"> ({d.server.offKeys} off)</span>} · {d.server.dispatches24h} in 24h · last {since(d.server.lastAt, now)}
                </span>
                {d.problem && (
                  <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-medium text-danger-foreground" data-testid={`pipeline-opener-${d.projectId}-problem`}>
                    {d.problem}
                    <Link to="/credits#cursor-fix-bugs" className="font-medium text-brand hover:underline">
                      Turn on a key →
                    </Link>
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-3 align-top text-fg-secondary">
                {d.local.runs24h} in 24h{d.local.running > 0 ? ` · ${d.local.running} running` : ''} · last {since(d.local.lastAt, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
