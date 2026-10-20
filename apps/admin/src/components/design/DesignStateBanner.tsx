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

/**
 * The server's element state only grades the deviance scan. When the token
 * lint below it lists problems, "OK · Code follows your design tokens" above
 * "Token issues · 200 found" is a contradiction (console audit 2026-10-20,
 * B7): the banner then says drift and names the count.
 * @internal exported for tests
 */
export function reconcileDesignState(
  design: Pick<DesignPlaneResponse, 'state' | 'reason'>,
  tokenIssueCount: number,
): { state: DesignPlaneResponse['state']; reason: string } {
  if (design.state === 'ok' && tokenIssueCount > 0) {
    return {
      state: 'drift',
      reason: `${tokenIssueCount} token issue${tokenIssueCount === 1 ? '' : 's'} to fix in your token files (listed below); the code itself follows the tokens it has.`,
    }
  }
  return { state: design.state, reason: design.reason }
}

export function DesignStateBanner({ design, tokenIssueCount = 0 }: { design: DesignPlaneResponse; tokenIssueCount?: number }) {
  const snap = design.snapshot
  const snapAt = rel(snap?.capturedAt)
  const errAt = rel(design.lastError?.at)
  const sourceLabel =
    snap && Object.prototype.hasOwnProperty.call(SOURCE_LABEL, snap.source) ? SOURCE_LABEL[snap.source] : snap?.source
  const shown = reconcileDesignState(design, tokenIssueCount)

  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <RecipeStateChip state={shown.state} />
        <span className="text-xs text-fg-secondary">{shown.reason}</span>
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
