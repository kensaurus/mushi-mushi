/**
 * FILE: apps/admin/src/components/intelligence/BenchmarkOptInCard.tsx
 * PURPOSE: Cross-customer benchmarking opt-in toggle card.
 */

import { Card, Toggle, Badge } from '../ui'
import type { BenchmarkSettings } from './types'
import { CHIP_TONE } from '../../lib/chipTone'

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
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
              Cross-customer benchmarking
            </span>
            <Badge className={benchmark.optIn ? CHIP_TONE.okSubtle : 'bg-surface-raised text-fg-muted'}>
              {benchmark.optIn ? 'Opted in' : 'Opted out'}
            </Badge>
          </div>
          <p className="max-w-xl text-2xs leading-relaxed text-fg-muted">
            Share aggregated, anonymised report metrics with other Mushi Mushi tenants. We enforce
            k-anonymity (≥ 5 contributing projects per bucket) — no project IDs, names, or report content
            ever leak.
          </p>
          {benchmark.optInAt && benchmark.optIn && (
            <p className="mt-1 text-2xs text-fg-faint">
              Opted in {new Date(benchmark.optInAt).toLocaleString()}.
            </p>
          )}
          {!benchmark.optIn && (
            <p className="mt-1 text-2xs text-fg-faint">
              Future digests will not include industry benchmark comparisons until you opt in.
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
