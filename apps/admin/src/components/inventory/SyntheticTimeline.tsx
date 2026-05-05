import { useMemo } from 'react'
import { Sparkline } from '../ui'

interface Run {
  ran_at: string
  latency_ms?: number | null
  status: string
}

interface Props {
  runs: Run[]
  actionLabel?: string
}

export function SyntheticTimeline({ runs, actionLabel }: Props) {
  const latencies = useMemo(() => {
    return [...runs]
      .reverse()
      .map((r) => (typeof r.latency_ms === 'number' && r.status === 'passed' ? r.latency_ms : 0))
      .filter((n) => n > 0)
  }, [runs])

  if (!runs.length) {
    return (
      <p className="text-2xs text-fg-muted py-4">No synthetic runs recorded yet — enable synthetic monitor in project settings.</p>
    )
  }

  const last = runs[0]
  const failCount = runs.filter((r) => r.status !== 'passed').length

  return (
    <div className="rounded-md border border-edge-subtle p-3 space-y-2">
      {actionLabel && <p className="text-xs font-medium text-fg truncate">{actionLabel}</p>}
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-2xs text-fg-muted uppercase">Last run</p>
          <p className="text-2xs font-mono">{new Date(last.ran_at).toLocaleString()}</p>
          <p className={`text-2xs ${last.status === 'passed' ? 'text-ok' : 'text-danger'}`}>{last.status}</p>
        </div>
        {latencies.length > 1 && (
          <div className="text-right">
            <p className="text-2xs text-fg-muted uppercase">Latency trend</p>
            <Sparkline values={latencies} width={96} height={22} />
          </div>
        )}
      </div>
      {failCount > 0 && (
        <p className="text-2xs text-warn">
          {failCount} non-pass run{failCount === 1 ? '' : 's'} in window
        </p>
      )}
    </div>
  )
}
