/**
 * FILE: apps/admin/src/components/intelligence/BenchmarkOptInCard.tsx
 * PURPOSE: Cross-customer benchmarking opt-in toggle card. Owns the optimistic
 *          UI dance — toggle is pure presentation, mutation is the page's job.
 */

import { Card, Toggle } from '../ui'
import type { BenchmarkSettings } from './types'

interface Props {
  benchmark: BenchmarkSettings
  onToggle: (next: boolean) => void
}

export function BenchmarkOptInCard({ benchmark, onToggle }: Props) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-fg uppercase tracking-wider mb-1">
            Cross-customer benchmarking
          </div>
          <p className="text-2xs text-fg-muted max-w-xl leading-relaxed">
            Opt in to share aggregated, anonymised report metrics with other Mushi Mushi tenants. We enforce
            k-anonymity (≥ 5 contributing projects per bucket) — no project IDs, names, or report content
            ever leak. Opt out any time.
            {benchmark.optInAt && (
              <span className="block mt-1 text-fg-faint">
                Opted in {new Date(benchmark.optInAt).toLocaleString()}.
              </span>
            )}
          </p>
        </div>
        <Toggle
          checked={benchmark.optIn}
          onChange={onToggle}
          label={benchmark.optIn ? 'Sharing on' : 'Sharing off'}
        />
      </div>
    </Card>
  )
}
