/**
 * FILE: apps/admin/src/components/recipe/RecipeChangeTab.tsx
 * PURPOSE: The side panel's Change tab for gates, env and routes (gap #8):
 *          read the element's fixed files (GET /recipe/sources), edit them in
 *          a form, preview the diff (dry run), then "Open draft PR" through
 *          POST /recipe/changes — the same API the propose_recipe_change MCP
 *          tool uses — and follow the job until the PR is open.
 *          Nothing is written to the default branch; the PR stays a draft.
 */

import type { ReactElement } from 'react'
import { Callout, ErrorAlert, Loading } from '../ui'
import { usePageData } from '../../lib/usePageData'
import type { RecipeElementKey, RecipeSourceElement, RecipeSourceFile, RecipeSources } from '../../lib/recipeTypes'
import { EnvForm, GatesForm, RoutesForm, type ChangeFormProps } from './RecipeChangeForms'
import { RecipeChangePreview } from './RecipeChangePreview'
import { recipeChangeLocksInputs, useRecipeChange } from './useRecipeChange'

export const CHANGE_TAB_ELEMENTS: readonly RecipeSourceElement[] = ['gates', 'env', 'routes']

export function hasChangeTab(key: RecipeElementKey): key is RecipeSourceElement {
  return (CHANGE_TAB_ELEMENTS as readonly string[]).includes(key)
}

const FORMS: Record<RecipeSourceElement, (p: ChangeFormProps) => ReactElement> = {
  gates: GatesForm,
  env: EnvForm,
  routes: RoutesForm,
}

/** Remount the form (fresh drafts) whenever the files it was built from change. */
function filesKey(files: readonly RecipeSourceFile[]): string {
  return files.map((f) => `${f.path}@${f.sha ?? 'absent'}`).join('|')
}

export function RecipeChangeTab({ projectId, element }: { projectId: string; element: RecipeSourceElement }) {
  const path = `/v1/admin/projects/${projectId}/recipe/sources?element=${element}`
  const { data, loading, error, reload } = usePageData<RecipeSources>(path)

  if (loading && !data) return <Loading text="Reading the files this change edits…" />
  if (error) return <ErrorAlert message={error} endpoint={path} onRetry={reload} />
  if (!data) return null
  if (!data.ok) {
    return (
      <Callout tone="warn" label="Nothing to edit yet">
        <p className="text-xs text-fg-secondary">{data.reason}</p>
      </Callout>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-2xs text-fg-muted">
        Read from <span className="font-mono">{data.branch}</span> at <span className="font-mono">{data.headSha.slice(0, 7)}</span>. Changes
        open as one draft pull request.
      </p>
      <ChangeFlow key={`${projectId}:${element}:${filesKey(data.files)}`} projectId={projectId} element={element} files={data.files} onReload={reload} />
    </div>
  )
}

function ChangeFlow({ projectId, element, files, onReload }: { projectId: string; element: RecipeSourceElement; files: RecipeSourceFile[]; onReload: () => void }) {
  const { state, preview, confirm, reset } = useRecipeChange(projectId, element)
  const Form = FORMS[element]
  const discard = () => {
    const finished = state.phase === 'done'
    reset()
    // After a PR (or a refusal), re-read the files so the next edit starts from the branch as it is now.
    if (finished) onReload()
  }
  return (
    <div className="space-y-3">
      <Form
        files={files}
        locked={recipeChangeLocksInputs(state)}
        previewing={state.phase === 'previewing'}
        onPreview={(edits) => void preview(edits)}
        onEdit={() => {
          if (state.phase === 'previewed' || state.phase === 'error') reset()
        }}
      />
      <RecipeChangePreview state={state} onConfirm={() => void confirm()} onDiscard={discard} />
    </div>
  )
}
