/**
 * FILE: apps/admin/src/components/intelligence/BenchmarkOptInCard.tsx
 * PURPOSE: Cross-customer benchmarking opt-in toggle card.
 */

import { Card, Toggle } from '../ui'
import type { BenchmarkSettings } from './types'

interface Props {
  benchmark: BenchmarkSettings
  onToggle: (next: boolean) => void
}

export function BenchmarkOptInCard({ benchmark, onToggle }: Props) {
  return (
    <Card className={`p-4 ${benchmark.optIn ? 'border-ok/30 bg-ok/5' : 'border-edge-subtle'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-fg-secondary">
              Cross-customer benchmarking
            </span>
            {/* The toggle says on/off once; an "Opted out" chip beside "Sharing off"
                said it twice (round-2 sweep 2026-11-18). */}
          </div>
          <p className="max-w-xl text-2xs leading-relaxed text-fg-muted">
            Compare your weekly numbers with other apps. Only totals from 5+ apps per bucket are shared: never names, IDs or report text.
          </p>
          {benchmark.optInAt && benchmark.optIn && (
            <p className="mt-1 text-2xs text-fg-faint">
              Opted in {new Date(benchmark.optInAt).toLocaleString()}.
            </p>
          )}
        </div>
        <Toggle
          checked={benchmark.optIn}
          onChange={onToggle}
          helpId="intelligence.benchmarking_optin"
          label={benchmark.optIn ? 'Sharing on' : 'Sharing off'}
        />
      </div>
    </Card>
  )
}
