/**
 * FILE: _shared/spec-validation.ts
 *
 * Pure, Deno-compatible spec-traceability validation.
 *
 * Mirrors `packages/agents/src/review.ts:validateAgainstSpec` so the Deno
 * Edge fix-worker can run the same pre-PR gate without importing the
 * Node-only `@mushi-mushi/agents` package. Both implementations must stay
 * structurally in sync — when you add a check to one, add it to the other.
 *
 * Rule of thumb: if a change here doesn't have a matching change in
 * agents/review.ts, create a ticket to port it.
 *
 * These checks are HEURISTICS — we err on the side of warnings (soft) over
 * errors (hard) to avoid blocking legitimate fixes where the ORM / code style
 * differs from the inventory literal. A hard error is reserved for the case
 * where the diff demonstrably deletes a property the contract asserts on.
 */

// ── Minimal types (no imports needed — keeps the module self-contained) ──────

interface DbOutcome {
  table: string
  schema?: string
  expect?: string
  where?: Record<string, unknown>
  min_count?: number
}

interface JsonPathCheck {
  path: string
  op: string
  value?: unknown
}

interface ResponseOutcome {
  status_in?: number[]
  json_path?: JsonPathCheck[]
}

interface UiOutcome {
  visible_text?: string
  route_change_to?: string
}

interface ExpectedOutcome {
  summary?: string
  response?: ResponseOutcome
  database?: DbOutcome
  ui?: UiOutcome
}

export interface InventoryAnchorForValidation {
  actionLabel: string
  actionDescription?: string
  pagePath?: string | null
  pageId?: string | null
  storyTitle?: string | null
  storyId?: string | null
  expectedOutcome: ExpectedOutcome | null | Record<string, unknown>
}

export interface EdgeSpecWarning {
  code: string
  message: string
  hint?: string
}

export interface EdgeSpecValidationResult {
  valid: boolean
  /** Hard violations — the diff demonstrably regresses a contract assertion. */
  errors: EdgeSpecWarning[]
  /** Soft signals — reviewers should eyeball before merging. */
  warnings: EdgeSpecWarning[]
}

// ── Validation logic (matches packages/agents/src/review.ts) ─────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Validate a generated fix against its inventory spec anchor.
 *
 * @param anchor   - inventory action metadata (from `resolveInventoryAnchor`)
 * @param files    - array of { path, contents } for every file the LLM modified
 * @param diffText - optional unified diff text (richer checks when present)
 */
export function validateEdgeSpec(
  anchor: InventoryAnchorForValidation,
  files: Array<{ path: string; contents: string }>,
  diffText?: string,
): EdgeSpecValidationResult {
  const errors: EdgeSpecWarning[] = []
  const warnings: EdgeSpecWarning[] = []

  if (!anchor.expectedOutcome || typeof anchor.expectedOutcome !== 'object') {
    return { valid: true, errors, warnings }
  }

  const eo = anchor.expectedOutcome as ExpectedOutcome
  const filePaths = files.map((f) => f.path)

  if (!filePaths.length && !diffText) {
    warnings.push({
      code: 'NO_DIFF',
      message: 'Spec validation skipped: no file list or diff text available.',
      hint: 'Ensure fix.files is non-empty before calling validateEdgeSpec.',
    })
    return { valid: true, errors, warnings }
  }

  // ── 1. DB table reference ─────────────────────────────────────────────────
  if (eo.database?.table) {
    const haystack = (diffText ?? '') + '\n' + filePaths.join('\n') +
      '\n' + files.map((f) => f.contents).join('\n')
    const tableNeedle = new RegExp(`\\b${escapeRegex(eo.database.table)}\\b`, 'i')
    if (!tableNeedle.test(haystack)) {
      warnings.push({
        code: 'DB_TABLE_MISSING',
        message: `Spec contract requires DB table \`${eo.database.table}\` but the diff doesn't reference it.`,
        hint: 'Your ORM may abstract the name — confirm the table is touched by the changed code.',
      })
    }
  }

  // ── 2. JSON path regression (hard error — field was deleted) ─────────────
  if (eo.response?.json_path?.length && diffText) {
    for (const check of eo.response.json_path) {
      const leaf = check.path.split('.').pop()
      if (!leaf || leaf.length < 3) continue
      const removed = new RegExp(`^-[^-].*\\b${escapeRegex(leaf)}\\b`, 'm').test(diffText)
      const added = new RegExp(`^\\+[^+].*\\b${escapeRegex(leaf)}\\b`, 'm').test(diffText)
      if (removed && !added) {
        errors.push({
          code: 'JSON_PATH_DELETED',
          message: `Diff removes field \`${leaf}\` that the expected_outcome contract asserts on (path \`${check.path}\`).`,
          hint: 'Restore the field or update inventory.yaml before merging.',
        })
      }
    }
  }

  // ── 3. Wrong page / surface ───────────────────────────────────────────────
  if (anchor.pagePath && (diffText || filePaths.length)) {
    const routeSlug = anchor.pagePath
      .replace(/^\//, '')
      .replace(/\/$/, '')
      .split('/')[0]
    if (routeSlug && routeSlug.length > 2) {
      const haystack = filePaths.join('\n') + (diffText ?? '')
      const referenced = new RegExp(`\\b${escapeRegex(routeSlug)}\\b`, 'i').test(haystack)
      if (!referenced) {
        warnings.push({
          code: 'WRONG_PAGE',
          message: `None of the changed files reference route slug \`${routeSlug}\` from action page \`${anchor.pagePath}\`.`,
          hint: 'Confirm the fix is scoped to the correct surface before merging.',
        })
      }
    }
  }

  // ── 4. UI visible text: check it exists in the changed code ──────────────
  if (eo.ui?.visible_text) {
    const allContents = files.map((f) => f.contents).join('\n')
    const needle = eo.ui.visible_text
    if (needle.length > 3 && !allContents.includes(needle)) {
      warnings.push({
        code: 'UI_TEXT_MISSING',
        message: `Expected UI text "${needle}" not found in changed file contents.`,
        hint: 'The fix might not surface the required text in the UI — verify manually.',
      })
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Render the inventory anchor as a Markdown block for the LLM prompt.
 * Replaces the inline `formatInventoryAnchor` copy in fix-worker so both
 * implementations share one canonical renderer.
 *
 * Identical in structure to `renderSpecContext` in @mushi-mushi/agents/review.ts
 * — the two must stay in sync.
 */
export function renderSpecContextEdge(anchor: InventoryAnchorForValidation): string {
  const lines: string[] = []
  lines.push('## Inventory Spec Context (whitepaper §2.10 spec-traceability)')
  lines.push(
    "This fix was dispatched against a tracked Action in the project's " +
      '`inventory.yaml`. Keep the diff scoped to making the action work as ' +
      'specified — do NOT refactor unrelated code or break sibling actions ' +
      'on the same page. The synthetic monitor will re-run the assertions ' +
      'below against staging immediately after the PR is opened.',
  )
  lines.push('')
  lines.push(`- Action: \`${anchor.actionLabel}\``)
  if (anchor.actionDescription) lines.push(`- Description: ${anchor.actionDescription}`)
  if (anchor.pagePath) {
    lines.push(
      `- Page: \`${anchor.pagePath}\`${anchor.pageId ? ` (id=\`${anchor.pageId}\`)` : ''}`,
    )
  }
  if (anchor.storyTitle) {
    lines.push(
      `- User story: ${anchor.storyTitle}${anchor.storyId ? ` (\`${anchor.storyId}\`)` : ''}`,
    )
  }

  const eo = (anchor.expectedOutcome && typeof anchor.expectedOutcome === 'object')
    ? anchor.expectedOutcome as ExpectedOutcome
    : null

  if (eo) {
    lines.push('')
    lines.push('### Expected outcome contract (success criteria after fix)')
    if (eo.summary) lines.push(`- Summary: ${eo.summary}`)
    const r = eo.response
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
    const d = eo.database
    if (d?.table) {
      const expect = d.expect ?? 'row_exists'
      const where = d.where ? ` WHERE ${JSON.stringify(d.where)}` : ''
      const min = d.min_count ? ` (min ${d.min_count})` : ''
      lines.push(
        `- Database: \`${d.schema ?? 'public'}.${d.table}\` MUST ${expect}${where}${min}`,
      )
    }
    const u = eo.ui
    if (u) {
      if (u.visible_text) lines.push(`- UI MUST show text containing: "${u.visible_text}"`)
      if (u.route_change_to) lines.push(`- UI MUST navigate to: \`${u.route_change_to}\``)
    }
    lines.push('')
    lines.push(
      'After the PR merges, the synthetic monitor will probe the action ' +
        'against this contract. A draft fix that the monitor then marks ' +
        '`regressed` is worse than no fix at all.',
    )
  } else {
    lines.push('')
    lines.push(
      '_No `expected_outcome` contract on this action. Add one to ' +
        '`inventory.yaml` so future fixes have explicit success criteria._',
    )
  }
  return lines.join('\n')
}
