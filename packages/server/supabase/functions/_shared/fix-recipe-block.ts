/**
 * FILE: packages/server/supabase/functions/_shared/fix-recipe-block.ts
 * PURPOSE: The recipe block in the fix-worker prompt (Plan 019 Phase 1b and
 *          Phase 2): the project's design tokens, so a fix uses
 *          `var(--color-action-primary)` instead of a hex literal (same ranking
 *          as get_fix_context's design excerpt, buildDesignExcerpt), plus the
 *          fixer context from fix-recipe-context.ts: tables named in the stack
 *          trace, the last fix's deploy state and open radar findings.
 *
 * Tokens come from the current app_recipe_snapshots row only (no repo fetch).
 * The whole block is capped at 4 KB and is never fatal: a failed read gives a
 * section that says so, never a crash.
 */

import type { getServiceClient } from './db.ts'
import { judgingSet, type StoredTokens } from './design-sets.ts'
import {
  CONTEXT_BUDGET_BYTES,
  formatFixRecipeContextBlock,
  loadFixRecipeContext,
  type ReportErrorEvidence,
} from './fix-recipe-context.ts'
import type { FixRecipeContext } from './recipe-types.ts'

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
  const cutLine = '(more tokens exist; the list was cut to stay short)\n'
  // Room for the cut line is kept back, so the block never exceeds maxBytes.
  const budget = maxBytes - enc.encode(cutLine).length
  let body = ''
  let cut = false
  for (const l of lines) {
    if (enc.encode(head + body + l + '\n').length > budget) {
      cut = true
      break
    }
    body += `${l}\n`
  }
  if (!body) return ''
  return `${head}${body}${cut ? cutLine : ''}`
}

/** The current snapshot's stored tokens. A miss or a failed read gives null (the block then has no tokens section). */
async function readCurrentTokens(db: Db, projectId: string): Promise<StoredTokens | null> {
  try {
    const { data, error } = await db.from('app_recipe_snapshots').select('tokens').eq('project_id', projectId).eq('is_current', true).maybeSingle()
    if (error || !data) return null
    return ((data as { tokens?: unknown }).tokens ?? null) as StoredTokens | null
  } catch {
    return null
  }
}

/** The whole recipe block in the fix-worker prompt is capped at this many bytes. */
export const RECIPE_BLOCK_MAX_BYTES = 4096

/**
 * The tokens block plus the fixer context (tables named in the stack trace,
 * the last fix's deploy state, open radar findings), together at most
 * RECIPE_BLOCK_MAX_BYTES. The context is written first and takes at most half;
 * the tokens fill what is left. Never throws.
 */
export function composeFixRecipeBlock(context: FixRecipeContext, tokens: StoredTokens | null, maxBytes = RECIPE_BLOCK_MAX_BYTES): string {
  const contextText = formatFixRecipeContextBlock(context, Math.min(CONTEXT_BUDGET_BYTES, Math.floor(maxBytes / 2)))
  // One byte for the newline that joins the two sections.
  const tokenText = formatRecipeTokenBlock(tokens, maxBytes - new TextEncoder().encode(contextText).length - 1)
  return tokenText ? `${tokenText}\n${contextText}` : contextText
}

/** Load and compose the full fix-worker recipe block for one report. Never throws. */
export async function loadFixRecipeBlock(db: Db, projectId: string, report: ReportErrorEvidence): Promise<string> {
  const [context, tokens] = await Promise.all([
    loadFixRecipeContext(db, projectId, { report }),
    readCurrentTokens(db, projectId),
  ])
  return composeFixRecipeBlock(context, tokens)
}
