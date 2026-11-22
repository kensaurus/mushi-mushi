/**
 * FILE: apps/admin/src/components/pipeline/PipelineSkeleton.tsx
 * PURPOSE: The pipeline's shape while GET /v1/admin/pipeline is in flight (2026-11-22). The
 *          read takes several seconds on a busy account (all apps: up to ~15 s), and the page
 *          showed one "Reading the pipeline…" spinner on an empty page for all of it. This
 *          draws the status line, the eight stages by name (they never change) and a list of
 *          stuck groups, so the page has its layout at once and nothing jumps when data lands.
 *          The stage names are real text; only the numbers are placeholders.
 */

import { Card, Skeleton } from '../ui'

/** The stages in order, as the server names them (lib/pipeline.ts PipelineStageId). */
const STAGE_NAMES = ['Reported', 'Triaged', 'Fix PR', 'Reviewed', 'CI', 'Release train', 'Merged', 'Deployed'] as const

export function PipelineSkeleton({ label = 'Reading the pipeline…' }: { label?: string }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true" data-testid="pipeline-skeleton">
      <div aria-hidden="true">
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="ml-auto h-7 w-28" />
        </Card>
      </div>
      <div className="@container" aria-hidden="true">
        <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-edge bg-edge @md:grid-cols-4 @4xl:grid-cols-8">
          {STAGE_NAMES.map((name) => (
            <li key={name} className="min-w-0 space-y-1.5 bg-surface-raised p-2.5">
              <span className="block truncate text-2xs font-medium text-fg-muted">{name}</span>
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-2.5 w-16" />
            </li>
          ))}
        </ol>
      </div>
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-3 w-32" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-md border border-edge-subtle border-l-4 border-l-edge bg-surface-raised p-2.5">
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>
      <p className="text-2xs text-fg-muted">{label}</p>
    </div>
  )
}
