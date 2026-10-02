/**
 * FILE: apps/admin/src/components/recipe/RecipeHeaderSummary.tsx
 * PURPOSE: Status strip above the Recipe canvas: the worst element state,
 *          whether a mushi.recipe.json was found (path, commit, capture time)
 *          and any manifest validation errors.
 */

import { Card, formatRelative } from '../ui'
import type { RecipeElementSummary, RecipeManifestStatus, RecipeResponse } from '../../lib/recipeTypes'
import { RecipeStateChip } from './RecipeStateChip'
import { RecipeIssueList } from './RecipeIssueList'
import { elementStateMeta, worstState } from './recipeState'

function relativeOrNull(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : formatRelative(d)
}

function ManifestLine({ manifest }: { manifest: RecipeManifestStatus }) {
  if (!manifest.present) {
    return (
      <span className="text-xs text-fg-secondary">
        Not found — this recipe is derived from what Mushi already observes.
      </span>
    )
  }
  const captured = relativeOrNull(manifest.capturedAt)
  return (
    <span className="text-xs text-fg-secondary">
      <span className="font-mono">{manifest.path ?? 'mushi.recipe.json'}</span>
      {manifest.commitSha && (
        <span className="ml-2 font-mono text-fg-muted" title={manifest.commitSha}>
          @ {manifest.commitSha.slice(0, 7)}
        </span>
      )}
      {captured && <span className="ml-2 text-fg-muted">read {captured}</span>}
    </span>
  )
}

export function RecipeHeaderSummary({ recipe, elements }: { recipe: RecipeResponse; elements: RecipeElementSummary[] }) {
  // Never trust `worst` alone: a card the server omitted renders as unknown,
  // and the header must not read OK above it.
  const worstKey = worstState([recipe.worst, ...elements.map((e) => e.state)])
  const worst = elementStateMeta(worstKey)
  const { manifest } = recipe
  const generated = relativeOrNull(recipe.generatedAt)

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wider text-fg-faint">Worst element</span>
          <span className="flex items-center gap-2">
            <RecipeStateChip state={worstKey} />
            <span className="text-xs text-fg-secondary">{worst.description}</span>
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-right">
          <span className="text-2xs uppercase tracking-wider text-fg-faint">mushi.recipe.json</span>
          <ManifestLine manifest={manifest} />
          {generated && <span className="text-2xs text-fg-faint">Composed {generated}</span>}
        </div>
      </div>
      {manifest.validationErrors.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-edge-subtle pt-2">
          <span className="text-xs font-medium text-fg-secondary">
            Manifest problems ({manifest.validationErrors.length})
          </span>
          <RecipeIssueList issues={manifest.validationErrors} />
        </div>
      )}
    </Card>
  )
}
