/**
 * FILE: packages/cli/src/recipe/report.ts
 * PURPOSE: What `mushi recipe check` prints and when it fails. Pure, so the
 *          exit rules are tested without a network:
 *            - a manifest error fails (checkRecipe's `ok`);
 *            - `--max-score n` fails when the local score is above n;
 *            - with `--push`, Mushi's answer fails the step when the project's
 *              deviance gate is on and the score Mushi computed is above its
 *              limit. A null score (nothing judged) and an older server that
 *              sends no gate never fail.
 */

import type { RecipeCheck } from './local.js'

/** The ingest's answer (POST /v1/ingest/recipe); `deviance` is absent on an older server. */
export interface RecipePushAnswer {
  state: string
  reason: string
  tokenCount: number
  findingsStored: number
  deviance?: {
    status: 'pass' | 'warn' | 'fail' | 'error' | 'skipped'
    runId: string | null
    score: number | null
    clientScore: number | null
    storedFindings: number
    droppedFindings: number
    gate: { enabled: boolean; failAbove: number | null; exceeded: boolean } | null
    action: { action: string; reportId?: string; newFindings?: number; code?: string; message?: string; error?: string } | null
    reason: string | null
  } | null
}

const SHOWN_FINDINGS = 50

/** The human-readable check result. */
export function describeCheck(result: RecipeCheck): string[] {
  const d = result.design
  const scope = d ? `${d.scannedFiles} files scanned${d.truncated ? ' (capped)' : ''}` : 'no scan'
  const score = d ? (d.score === null ? ', not scored (no rule had anything to judge)' : `, deviance score ${d.score}/100`) : ''
  const lines = [`${result.ok ? 'OK' : 'FAIL'}  mushi.recipe.json: ${result.tokenCount} tokens${d?.set ? ` (set ${d.set})` : ''}, ${scope}${score}.`]
  for (const i of result.issues) lines.push(`  ${i.severity.toUpperCase().padEnd(5)} ${i.message}`)
  for (const f of result.findings.slice(0, SHOWN_FINDINGS)) {
    const at = f.file_path ? `${f.file_path}${f.line ? `:${f.line}${f.col ? `:${f.col}` : ''}` : ''}` : 'tokens'
    const use = f.suggestion ? ` → ${f.suggestion.cssVar ?? f.suggestion.ts ?? f.suggestion.token}` : ''
    lines.push(`  ${f.severity.toUpperCase().padEnd(5)} ${at}  ${f.message}${use}  [${f.rule_id}]`)
  }
  if (result.findings.length > SHOWN_FINDINGS) lines.push(`  … and ${result.findings.length - SHOWN_FINDINGS} more`)
  return lines
}

export function localLimitExceeded(score: number | null, maxScore: number | null): boolean {
  return maxScore !== null && score !== null && score > maxScore
}

/** What to print after a push, and whether the CI step fails. */
export function pushVerdict(answer: RecipePushAnswer, maxScore: number | null, localScore: number | null): { lines: string[]; errors: string[]; failed: boolean } {
  const lines = [`Sent to Mushi: ${answer.reason}`]
  const errors: string[] = []
  let failed = localLimitExceeded(localScore, maxScore)
  const d = answer.deviance
  if (!d) {
    if (localScore !== null) lines.push('Mushi stored the recipe but did not score the scan (it may be older than this CLI).')
    return { lines, errors, failed }
  }
  if (d.status === 'skipped') lines.push(`Not scored: ${d.reason ?? 'no design tokens to judge against.'}`)
  else if (d.status === 'error') errors.push(`Mushi could not store the scan: ${d.reason ?? 'unknown error'}`)
  else {
    const refused = d.droppedFindings > 0 ? `, ${d.droppedFindings} refused` : ''
    lines.push(`Mushi scored ${d.score === null ? 'nothing (no rule had anything to judge)' : `${d.score}/100`}: ${d.storedFindings} findings stored${refused}.`)
  }
  if (d.clientScore !== null && d.clientScore !== undefined) {
    errors.push(`This CLI scored ${d.clientScore}, Mushi scored ${d.score}. Update @mushi-mushi/cli so both run the same rules.`)
  }
  if (d.gate?.enabled) {
    if (d.gate.exceeded) {
      errors.push(`Deviance score ${d.score} is above this project's limit of ${d.gate.failAbove} (console: Design system → When the score is too high).`)
      failed = true
    } else {
      lines.push(`Within the project's limit of ${d.gate.failAbove}.`)
    }
  }
  if (d.reason && d.status !== 'skipped' && d.status !== 'error') errors.push(d.reason)
  const a = d.action
  if (a?.action === 'dispatched') lines.push(`Mushi dispatched a fix for ${a.newFindings ?? 'the'} new finding${a.newFindings === 1 ? '' : 's'} (report ${a.reportId}).`)
  else if (a?.action === 'dispatch_refused') lines.push(`Design auto-fix did not dispatch: ${a.message ?? a.code ?? 'refused'}.`)
  else if (a?.action === 'autofix_disabled') lines.push('Design auto-fix is on, but Autofix is off for this project, so no fix was dispatched.')
  else if (a?.action === 'settings_unavailable' || a?.action === 'report_failed') errors.push(`Design auto-fix failed: ${a.error ?? a.action}.`)
  return { lines, errors, failed }
}
