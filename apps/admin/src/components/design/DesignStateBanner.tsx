/**
 * FILE: apps/admin/src/components/design/DesignStateBanner.tsx
 * PURPOSE: Top-of-page status for the design plane: element state + reason,
 *          the token snapshot it reads from, and the newest failed refresh or
 *          scan when that failure is newer than the snapshot.
 */

import { Card, formatRelative } from '../ui'
import type { DesignPlaneResponse, RecipeHistoryEntry } from '../../lib/recipeTypes'
import { RecipeStateChip } from '../recipe/RecipeStateChip'

function rel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : formatRelative(d)
}

const SOURCE_LABEL: Record<RecipeHistoryEntry['source'], string> = {
  repo_file: 'repo files',
  ci_ingest: 'a CI push',
  derived: 'derived data',
  connector: 'a connector',
}

export function DesignStateBanner({ design }: { design: DesignPlaneResponse }) {
  const snap = design.snapshot
  const snapAt = rel(snap?.capturedAt)
  const errAt = rel(design.lastError?.at)
  const sourceLabel =
    snap && Object.prototype.hasOwnProperty.call(SOURCE_LABEL, snap.source) ? SOURCE_LABEL[snap.source] : snap?.source

  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <RecipeStateChip state={design.state} />
        <span className="text-xs text-fg-secondary">{design.reason}</span>
      </div>
      <p className="text-2xs text-fg-muted">
        {snap ? (
          <>
            Tokens read from {sourceLabel}
            {snapAt ? ` ${snapAt}` : ''}
            {snap.commitSha && (
              <span className="ml-1 font-mono" title={snap.commitSha}>
                @ {snap.commitSha.slice(0, 7)}
              </span>
            )}
            {design.manifest.present && design.manifest.path && (
              <span className="ml-1">
                via <span className="font-mono">{design.manifest.path}</span>
              </span>
            )}
          </>
        ) : (
          'No token snapshot yet — add mushi.recipe.json with your token files, then refresh.'
        )}
      </p>
      {design.lastError && (
        <p className="text-xs text-danger" role="alert">
          <span className="font-medium">Last refresh or scan failed{errAt ? ` ${errAt}` : ''}:</span>{' '}
          {design.lastError.message}
        </p>
      )}
    </Card>
  )
}
