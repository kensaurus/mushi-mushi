import type { FixContext, FixResult, ReviewResult } from './types.js'

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
  /password\s*[:=]\s*['"][^'"]+['"]/i,
  /secret\s*[:=]\s*['"][^'"]+['"]/i,
  /\.env/,
  /credentials/i,
  /private[_-]?key/i,
]

export function checkForSecrets(diff: string): { clean: boolean; findings: string[] } {
  const findings: string[] = []
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(diff)) {
      findings.push(`Potential secret pattern: ${pattern.source}`)
    }
  }
  return { clean: findings.length === 0, findings }
}

/**
 * Render the inventory anchor for inclusion in the review (and the agent's
 * own fix-generation) prompt. Returns an empty string when the fix wasn't
 * dispatched against an Action — keeps legacy reports flowing through
 * unchanged.
 *
 * The shape of this block is load-bearing for the rest of the system:
 *   - It tells the agent which surface the user was actually using, so the
 *     diff stays scoped to that surface instead of touching adjacent code.
 *   - It includes the `expected_outcome` contract verbatim so the agent
 *     has the post-merge success criteria up-front (not "a 2xx" — the
 *     specific JSONPath/database/UI assertions the synthetic monitor is
 *     about to run).
 *   - It lists the user story so the agent can argue, at review time,
 *     that the fix preserves the story's intent (whitepaper §2.10).
 */
export function renderSpecContext(context: FixContext): string {
  const ia = context.inventoryAction
  if (!ia) return ''
  const lines: string[] = []
  lines.push('## Inventory Spec Context (whitepaper §2.10 spec-traceability)')
  lines.push(
    'This fix was dispatched against a tracked Action in the project\'s ' +
      '`inventory.yaml`. The agent and the reviewer MUST keep the diff ' +
      'scoped to making the action work as specified — do NOT refactor ' +
      'unrelated code or break sibling actions on the same page.',
  )
  lines.push('')
  lines.push(`- Action: \`${ia.actionLabel}\``)
  if (ia.actionDescription) lines.push(`- Description: ${ia.actionDescription}`)
  if (ia.pagePath) lines.push(`- Page: \`${ia.pagePath}\`${ia.pageId ? ` (id=\`${ia.pageId}\`)` : ''}`)
  if (ia.storyTitle) {
    lines.push(`- User story: ${ia.storyTitle}${ia.storyId ? ` (\`${ia.storyId}\`)` : ''}`)
  }
  if (ia.expectedOutcome) {
    lines.push('')
    lines.push('### Expected outcome contract (success criteria after fix)')
    if (ia.expectedOutcome.summary) {
      lines.push(`- Summary: ${ia.expectedOutcome.summary}`)
    }
    const r = ia.expectedOutcome.response
    if (r) {
      if (r.status_in?.length) lines.push(`- HTTP status MUST be one of: ${r.status_in.join(', ')}`)
      if (r.json_path?.length) {
        lines.push('- Response body assertions:')
        for (const c of r.json_path) {
          const valuePart = c.value === undefined ? '' : ` ${JSON.stringify(c.value)}`
          lines.push(`  - \`${c.path}\` ${c.op}${valuePart}`)
        }
      }
    }
    const d = ia.expectedOutcome.database
    if (d) {
      const expect = d.expect ?? 'row_exists'
      const where = d.where ? ` WHERE ${JSON.stringify(d.where)}` : ''
      const min = d.min_count ? ` (min ${d.min_count})` : ''
      lines.push(`- Database: \`${d.schema ?? 'public'}.${d.table}\` MUST ${expect}${where}${min}`)
    }
    const u = ia.expectedOutcome.ui
    if (u) {
      if (u.visible_text) lines.push(`- UI MUST show text containing: "${u.visible_text}"`)
      if (u.route_change_to) lines.push(`- UI MUST navigate to: \`${u.route_change_to}\``)
    }
    lines.push('')
    lines.push(
      'After the PR merges, the synthetic monitor will probe the action ' +
        'against this contract. A draft fix that the synthetic monitor ' +
        'will then immediately mark `regressed` is worse than no fix at all.',
    )
  }
  return lines.join('\n')
}

export function buildReviewPrompt(context: FixContext, diff: string): string {
  const spec = renderSpecContext(context)
  return `You are reviewing an AI-generated code fix. Determine if it correctly addresses the reported issue AND preserves the inventory contract for the action it touches.

## Original Bug Report
- Summary: ${context.report.summary}
- Category: ${context.report.category}
- Severity: ${context.report.severity}
- Component: ${context.report.component ?? 'unknown'}
- Root Cause: ${context.report.rootCause ?? 'unknown'}

## Reproduction Steps
${context.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${spec ? `${spec}\n\n` : ''}## Code Diff
\`\`\`diff
${diff.slice(0, 5000)}
\`\`\`

Answer:
1. Does this fix address the reported issue?
2. Does it introduce any unrelated changes?
3. Could it cause any regressions?
${context.inventoryAction ? '4. Does the fix still satisfy every assertion in the expected_outcome contract above? If you cannot tell from the diff, say so explicitly.' : ''}

Approve only if the fix is focused, correct, safe, and ${context.inventoryAction ? 'preserves every assertion in the expected_outcome contract.' : 'addresses the reported issue.'}`
}

export function parseReviewResponse(response: string): ReviewResult {
  const lower = response.toLowerCase()
  const approved = lower.includes('approve') && !lower.includes('do not approve') && !lower.includes('reject')
  return { approved, reasoning: response.slice(0, 500) }
}

/**
 * Static, deterministic spec-traceability check. Runs in the orchestrator's
 * `validateResult` slot BEFORE we ever push a PR. Catches the cheap-to-detect
 * regressions that the LLM review might miss (or hallucinate around):
 *
 *   - The expected_outcome.database.table is referenced by the diff (so the
 *     fix actually touches the persistence path the action depends on).
 *   - A response.json_path with `op: equals` on a literal value isn't being
 *     deleted from the codebase (i.e. the agent didn't remove the very
 *     property the contract asserts on).
 *   - When the inventoryAction is set, the diff didn't go and edit a
 *     completely different page than `inventoryAction.pagePath`.
 *
 * These are heuristics — false positives would be worse than false negatives
 * (we don't want to block a legitimate fix because the contract phrased the
 * field as `userId` and the codebase calls it `user_id`). So we return a
 * STRUCTURED result that the caller can choose to enforce or just log;
 * `errors` is non-empty only on hard violations.
 *
 * Returns the same `{ valid, errors }` shape FixAgent.validateResult expects
 * so adapters can wire it directly.
 */
export interface SpecValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateAgainstSpec(
  context: FixContext,
  result: FixResult,
  diffText?: string,
): SpecValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const ia = context.inventoryAction

  if (!ia) {
    return { valid: true, errors, warnings }
  }

  // We can only run heuristic checks if we have either the file list or the
  // diff text. Adapters that don't surface the diff (legacy MCP path) get
  // a soft warning instead of a hard fail.
  if (!result.filesChanged.length && !diffText) {
    warnings.push(
      'Spec validation skipped: agent did not surface a file list or diff text. ' +
        'Set FixResult.filesChanged or pass diffText so the inventory contract can be verified.',
    )
    return { valid: true, errors, warnings }
  }

  const eo = ia.expectedOutcome
  if (eo?.database?.table) {
    const haystack = (diffText ?? '') + '\n' + result.filesChanged.join('\n')
    const tableNeedle = new RegExp(`\\b${escapeRegex(eo.database.table)}\\b`, 'i')
    if (!tableNeedle.test(haystack)) {
      warnings.push(
        `Spec contract requires DB table \`${eo.database.table}\` but the diff doesn't reference it. ` +
          'This is a soft warning — your ORM may abstract the table name — but worth a human glance.',
      )
    }
  }

  if (eo?.response?.json_path?.length && diffText) {
    for (const check of eo.response.json_path) {
      // Only reason about leaf field names (last `.` segment) to avoid
      // tripping over JSONPath flavours we don't fully parse here.
      const leaf = check.path.split('.').pop()
      if (!leaf || leaf.length < 3) continue
      // If the diff DELETES this property name (i.e. a leading `-` line
      // mentions it) AND nothing re-introduces it, that's a regression.
      const removed = new RegExp(`^-[^-].*\\b${escapeRegex(leaf)}\\b`, 'm').test(diffText)
      const added = new RegExp(`^\\+[^+].*\\b${escapeRegex(leaf)}\\b`, 'm').test(diffText)
      if (removed && !added) {
        errors.push(
          `Diff removes field \`${leaf}\` that the expected_outcome contract asserts on (path \`${check.path}\`). ` +
            'Either restore the field or update the inventory.yaml contract before merging.',
        )
      }
    }
  }

  if (ia.pagePath && diffText) {
    // Heuristic: if EVERY filename in the diff explicitly mentions a
    // different `/pages/` or `/app/` route, flag — the agent might have
    // edited the wrong page entirely. We only fire when the diff has at
    // least one file path AND none of them mention the action's pagePath.
    const routeSlug = ia.pagePath
      .replace(/^\//, '')
      .replace(/\/$/, '')
      .split('/')[0]
    if (routeSlug && routeSlug.length > 2) {
      const referenced = result.filesChanged.some((p) => p.toLowerCase().includes(routeSlug.toLowerCase()))
      if (!referenced) {
        warnings.push(
          `None of the changed files mention the route slug \`${routeSlug}\` from action page \`${ia.pagePath}\`. ` +
            'The fix might be touching the wrong surface — confirm before merging.',
        )
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
