/**
 * FILE: apps/admin/src/components/recipe/RecipeHeaderSummary.tsx
 * PURPOSE: Status strip above the Recipe canvas: the overall state (the worst
 *          element) with the parts that need a look named, whether the app's
 *          recipe file (mushi.recipe.json) was found, and any errors in it.
 *          The filename appears only as the exact next step, never as a heading.
 */

import { Card, formatRelative } from '../ui'
import type { RecipeElementSummary, RecipeManifestStatus, RecipeResponse } from '../../lib/recipeTypes'
import { RecipeStateChip } from './RecipeStateChip'
import { RecipeIssueList } from './RecipeIssueList'
import { elementStateMeta, elementsBehindWorst, worstState } from './recipeState'

function relativeOrNull(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : formatRelative(d)
}

function ManifestLine({ manifest }: { manifest: RecipeManifestStatus }) {
  if (!manifest.present) {
    return (
      <span className="text-xs text-fg-secondary">
        Not added yet. This page is built from what Mushi already sees. To declare design tokens, deploy targets and budgets, add a file named{' '}
        <span className="font-mono">mushi.recipe.json</span> at your repo root.
      </span>
    )
  }
  const captured = relativeOrNull(manifest.capturedAt)
  return (
    <span className="text-xs text-fg-secondary">
      Found <span className="font-mono">{manifest.path ?? 'mushi.recipe.json'}</span>
      {manifest.commitSha && (
        <span className="ml-1 font-mono text-fg-muted" title={manifest.commitSha}>
          at commit {manifest.commitSha.slice(0, 7)}
        </span>
      )}
      {captured && <span className="text-fg-muted">, read {captured}</span>}
    </span>
  )
}

export function RecipeHeaderSummary({ recipe, elements }: { recipe: RecipeResponse; elements: RecipeElementSummary[] }) {
  // Never trust `worst` alone: a card the server omitted renders as unknown,
  // and the header must not read OK above it.
  const worstKey = worstState([recipe.worst, ...elements.map((e) => e.state)])
  const worst = elementStateMeta(worstKey)
  const behind = elementsBehindWorst(elements)
  const { manifest } = recipe
  const generated = relativeOrNull(recipe.generatedAt)

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-fg-secondary">Overall</span>
          <span className="flex flex-wrap items-center gap-2">
            <RecipeStateChip state={worstKey} lastCheckedAt={behind.length > 0 && behind.every((e) => e.lastCheckedAt) ? behind[0].lastCheckedAt : null} />
            <span className="text-sm text-fg">
              {behind.length > 0 ? behind.map((e) => e.label).join(', ') : worst.description}
            </span>
          </span>
          {behind.length > 0 && <span className="text-xs text-fg-muted">Open a card below for what is wrong and how to fix it.</span>}
        </div>
        <div className="flex min-w-0 flex-col gap-1 sm:max-w-md sm:text-right">
          <span className="text-xs font-medium text-fg-secondary">Recipe file</span>
          <ManifestLine manifest={manifest} />
          {generated && <span className="text-xs text-fg-faint">Page built {generated}</span>}
        </div>
      </div>
      {manifest.validationErrors.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-edge-subtle pt-2">
          <span className="text-xs font-medium text-fg-secondary">
            Your recipe file has {manifest.validationErrors.length} problem{manifest.validationErrors.length === 1 ? '' : 's'}. Fix them in the repo, then press Refresh.
          </span>
          <RecipeIssueList issues={manifest.validationErrors} />
        </div>
      )}
    </Card>
  )
}
