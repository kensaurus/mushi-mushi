/**
 * FILE: apps/admin/src/components/recipe/RecipeHeaderSummary.tsx
 * PURPOSE: Status strip above the Recipe canvas: the overall state (the worst
 *          element) with the parts that need a look named, whether the app's
 *          recipe file (mushi.recipe.json) was found, and any errors in it.
 *          The filename appears only as the exact next step, never as a heading.
 */

import { Btn, Card, formatRelative } from '../ui'
import type { RecipeElementKey, RecipeElementSummary, RecipeManifestStatus, RecipeResponse } from '../../lib/recipeTypes'
import { RecipeStateChip } from './RecipeStateChip'
import { RecipeIssueList } from './RecipeIssueList'
import { classifyLinkTarget, elementStateMeta, elementsBehindWorst, firstSentence, recipeReasonText, worstState } from './recipeState'
import { StatusGlyph, TONE_INK } from '../signal/StatusGlyph'

/** Rank of a tone for "which is worse": red over amber over the rest. */
function toneRank(tone: string): number {
  return tone === 'danger' || tone === 'danger' ? 2 : tone === 'warn' || tone === 'warn' ? 1 : 0
}

function relativeOrNull(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : formatRelative(d)
}

function ManifestLine({ manifest }: { manifest: RecipeManifestStatus }) {
  if (!manifest.present) {
    return (
      <span className="text-xs text-fg-secondary">
        Not added yet. This page is built from what Mushi Mushi already sees. To declare design tokens, deploy targets and budgets, add a file named{' '}
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

/** The one next step: the first box in the worst state, and the page that fixes it when it names one. */
function NextStep({ element, onSelect }: { element: RecipeElementSummary; onSelect?: (key: RecipeElementKey) => void }) {
  const fixLink = element.links.find((l) => classifyLinkTarget(l.to) === 'internal')
  return (
    <div className="flex flex-col gap-2 border-t border-edge-subtle pt-2 sm:flex-row sm:items-center sm:justify-between" data-testid="recipe-next-step">
      <p className="min-w-0 text-xs text-fg-secondary" title={recipeReasonText(element.reason)}>
        <span className="font-medium text-fg">Next step, {element.label}: </span>
        {firstSentence(recipeReasonText(element.reason))}
      </p>
      <span className="flex shrink-0 flex-wrap gap-2">
        {fixLink ? (
          <Btn size="sm" variant="primary" to={fixLink.to}>
            {fixLink.label}
          </Btn>
        ) : null}
        {onSelect ? (
          <Btn size="sm" variant={fixLink ? 'ghost' : 'primary'} onClick={() => onSelect(element.key)}>
            Show how to fix
          </Btn>
        ) : null}
      </span>
    </div>
  )
}

export function RecipeHeaderSummary({
  recipe,
  elements,
  risk = null,
  onSelect,
}: {
  recipe: RecipeResponse
  elements: RecipeElementSummary[]
  /** The worst risk check (RadarPanel, radarOverall). Overall takes the worse of it and the boxes. */
  risk?: { tone: 'danger' | 'warn'; label: string } | null
  /** Opens a box's side panel: the next step's "Show how to fix". */
  onSelect?: (key: RecipeElementKey) => void
}) {
  // Never trust `worst` alone: a card the server omitted renders as unknown,
  // and the header must not read OK above it.
  const worstKey = worstState([recipe.worst, ...elements.map((e) => e.state)])
  const worst = elementStateMeta(worstKey)
  const behind = elementsBehindWorst(elements)
  // Overall is the worst thing on the page, risk checks included (round 3).
  const riskRank = risk ? toneRank(risk.tone) : 0
  const boxRank = toneRank(worst.tone)
  const riskLeads = risk != null && riskRank > boxRank
  const named = [...(risk && riskRank >= boxRank && riskRank > 0 ? ['Risk checks'] : []), ...(riskLeads ? [] : behind.map((e) => e.label))]
  const { manifest } = recipe
  const generated = relativeOrNull(recipe.generatedAt)
  // "No mushi.recipe.json at the repo root" restates the missing-file line above: say it once (2026-11-18).
  const issues = manifest.present ? manifest.validationErrors : manifest.validationErrors.filter((i) => i.code !== 'MANIFEST_MISSING')

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {/* The page's lead (PageStatus) carries the risk checks; without them this card is the blueprint alone. */}
          <span className="text-xs font-medium text-fg-secondary">{risk ? 'Overall' : 'Blueprint'}</span>
          <span className="flex flex-wrap items-center gap-2">
            {riskLeads && risk ? (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${TONE_INK[risk.tone]}`} data-testid="recipe-overall-risk">
                <StatusGlyph tone={risk.tone} />
                {risk.label}
              </span>
            ) : (
              <RecipeStateChip state={worstKey} lastCheckedAt={behind.length > 0 && behind.every((e) => e.lastCheckedAt) ? behind[0].lastCheckedAt : null} />
            )}
            <span className="text-sm text-fg">
              {named.length > 0 ? named.join(', ') : worst.description}
            </span>
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1 sm:max-w-md sm:text-right">
          <span className="text-xs font-medium text-fg-secondary">Recipe file</span>
          <ManifestLine manifest={manifest} />
          {generated && <span className="text-xs text-fg-faint">Page built {generated}</span>}
        </div>
      </div>
      {behind[0] ? <NextStep element={behind[0]} onSelect={onSelect} /> : null}
      {issues.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-edge-subtle pt-2">
          <span className="text-xs font-medium text-fg-secondary">
            Your recipe file has {issues.length} problem{issues.length === 1 ? '' : 's'}. Fix them in the repo, then press Refresh.
          </span>
          <RecipeIssueList issues={issues} />
        </div>
      )}
    </Card>
  )
}
