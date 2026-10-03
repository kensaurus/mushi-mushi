/**
 * FILE: packages/server/supabase/functions/_shared/fix-recipe-block.ts
 * PURPOSE: The recipe block in the fix-worker prompt (Plan 019 Phase 1b,
 *          tokens only at this stage): the project's design tokens, so a fix
 *          uses `var(--color-action-primary)` instead of a hex literal. Same
 *          ranking as get_fix_context's design excerpt (buildDesignExcerpt).
 *
 * Read from the current app_recipe_snapshots row only (no repo fetch), capped
 * in bytes, and never fatal: no snapshot or a failed read gives no block.
 */

import type { getServiceClient } from './db.ts'
import { judgingSet, type StoredTokens } from './design-sets.ts'

type Db = ReturnType<typeof getServiceClient>

const SAFE = /^[\w.\-#%(),/ ]+$/

function rank(path: string, mapped: boolean): number {
  const g = path.split('.')[0]
  const group = g === 'color' ? 0 : g === 'font' || g === 'typography' ? 1 : g === 'space' || g === 'spacing' ? 2 : g === 'radius' ? 3 : 4
  return (mapped ? 0 : 10) + group
}

/** The prompt section for these stored tokens, or '' when there is nothing to say. */
export function formatRecipeTokenBlock(stored: StoredTokens | null, maxBytes = 2048): string {
  const set = judgingSet(stored)
  if (!set) return ''
  const lines = set.tokens
    // Repo text: keep only short, plain values so a token file cannot carry instructions.
    .filter((t) => !t.path.includes('.palette.') && t.display.length <= 60 && SAFE.test(t.path) && SAFE.test(t.display))
    .sort((a, b) => rank(a.path, Boolean(a.cssVar || a.ts)) - rank(b.path, Boolean(b.cssVar || b.ts)) || a.path.localeCompare(b.path))
    .map((t) => {
      const names = [t.cssVar && /^--[\w-]+$/.test(t.cssVar) ? `var(${t.cssVar})` : null, t.ts && /^[\w.]+$/.test(t.ts) ? t.ts : null].filter(Boolean).join(' / ')
      return `- ${t.path} = ${t.display}${names ? ` (${names})` : ''}`
    })
  if (lines.length === 0) return ''
  const head = `## Design tokens (from the project's mushi.recipe.json, set "${set.name.replace(/[^\w .-]/g, '')}")\nUse these instead of literal colours, fonts, spacing or radii. Do not edit token files in this fix.\n`
  const enc = new TextEncoder()
  let body = ''
  let cut = false
  for (const l of lines) {
    if (enc.encode(head + body + l + '\n').length > maxBytes) {
      cut = true
      break
    }
    body += `${l}\n`
  }
  if (!body) return ''
  return `${head}${body}${cut ? '(more tokens exist; the list was cut to stay short)\n' : ''}`
}

/** Load the block for a project. Never throws: a miss or a failed read gives ''. */
export async function loadRecipeTokenBlock(db: Db, projectId: string): Promise<string> {
  try {
    const { data, error } = await db.from('app_recipe_snapshots').select('tokens').eq('project_id', projectId).eq('is_current', true).maybeSingle()
    if (error || !data) return ''
    return formatRecipeTokenBlock(((data as { tokens?: unknown }).tokens ?? null) as StoredTokens | null)
  } catch {
    return ''
  }
}
