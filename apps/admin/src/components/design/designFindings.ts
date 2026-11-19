/**
 * FILE: apps/admin/src/components/design/designFindings.ts
 * PURPOSE: The Design system page's work list (owner, 2026-11-19): the real hard-coded-style
 *          findings grouped by file, worst file first, with a fix prompt per file and one for
 *          all of them; the token-file format notes folded into one row; and the lead's
 *          sentence, numbers and next step. Pure: no React.
 */

import type { PageStatusMetric, PageStatusTone } from '../ui/page-status'
import type { DesignPlaneResponse, DevianceFinding, RecipeIssue } from '../../lib/recipeTypes'
import { issueCodeLabel } from '../recipe/recipeIssueLabels'

export interface FileGroup {
  file: string
  findings: DevianceFinding[]
  /** Findings per rule in this file, biggest first. */
  rules: Array<{ rule: string; count: number }>
  errors: number
}

const SEV_RANK: Record<string, number> = { error: 0, warn: 1, info: 2 }

/** Findings → one group per file: most errors, then most findings, then the name. */
export function groupFindingsByFile(findings: readonly DevianceFinding[]): FileGroup[] {
  const byFile = new Map<string, DevianceFinding[]>()
  for (const f of findings) {
    const file = f.file_path ?? '(file not known)'
    byFile.set(file, [...(byFile.get(file) ?? []), f])
  }
  return [...byFile.entries()]
    .map(([file, list]) => {
      const rules = new Map<string, number>()
      for (const f of list) rules.set(f.rule_id, (rules.get(f.rule_id) ?? 0) + 1)
      return {
        file,
        findings: [...list].sort((a, b) => (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3) || (a.line ?? 0) - (b.line ?? 0)),
        rules: [...rules.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
        errors: list.filter((f) => f.severity === 'error').length,
      }
    })
    .sort((a, b) => b.errors - a.errors || b.findings.length - a.findings.length || a.file.localeCompare(b.file))
}

function findingLine(f: DevianceFinding): string {
  const at = f.line != null ? `line ${f.line}` : 'somewhere in the file'
  const use = f.suggestion ? ` → use ${f.suggestion.cssVar ?? f.suggestion.token}${f.suggestion.value ? ` (${f.suggestion.value})` : ''}` : ''
  return `- ${at}: ${f.value ? `\`${f.value}\` ` : ''}${f.message.trim().replace(/\.$/, '')}${use}`
}

const RULES =
  'Replace each hard-coded value with the design token named (or the closest token in the design system). Do not add new tokens unless none fits, keep the look the same, and run the tests.'

/** One file's prompt for the editor. */
export function fileFixPrompt(g: FileGroup): string {
  return [
    `Mushi Mushi's design drift check found ${g.findings.length} hard-coded style${g.findings.length === 1 ? '' : 's'} in ${g.file} that bypass the design tokens:`,
    g.findings.map(findingLine).join('\n'),
    RULES,
  ].join('\n\n')
}

/** Every file in one prompt (capped so a paste stays usable; the rest is counted). */
export function allFilesFixPrompt(groups: readonly FileGroup[], maxFiles = 25): string {
  const shown = groups.slice(0, maxFiles)
  const total = groups.reduce((n, g) => n + g.findings.length, 0)
  return [
    `Mushi Mushi's design drift check found ${total} hard-coded style${total === 1 ? '' : 's'} in ${groups.length} file${groups.length === 1 ? '' : 's'} that bypass the design tokens.`,
    ...shown.map((g) => `${g.file}\n${g.findings.map(findingLine).join('\n')}`),
    groups.length > shown.length ? `And ${groups.length - shown.length} more files: fix these first, then run the drift check again.` : null,
    RULES,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Format notes grouped by code, in plain words, biggest first. */
export function formatNoteGroups(notes: readonly RecipeIssue[]): Array<{ code: string; label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const n of notes) counts.set(n.code, (counts.get(n.code) ?? 0) + 1)
  return [...counts.entries()].map(([code, count]) => ({ code, label: issueCodeLabel(code), count })).sort((a, b) => b.count - a.count)
}

/** The prompt that rewrites every format note into the current DTCG form. */
export function formatNotesPrompt(notes: readonly RecipeIssue[]): string {
  const files = [...new Set(notes.map((n) => n.file).filter((f): f is string => !!f))]
  const kinds = formatNoteGroups(notes).map((g) => `- ${g.label}: ${g.count}`)
  return [
    `Mushi Mushi read ${notes.length} design token${notes.length === 1 ? '' : 's'} written in an older format${files.length ? ` in ${files.join(', ')}` : ''}:`,
    kinds.join('\n'),
    'Rewrite them in the DTCG 2025.10 format: a colour as {"colorSpace": "srgb", "components": [r, g, b]} (keep "hex" too), a size or duration as {"value": 16, "unit": "px"} / {"value": 200, "unit": "ms"}. Keep every value and name the same, so nothing in the app changes.',
  ].join('\n\n')
}

/** Every finding the newest scan counted (stored rows are capped; `counts` holds the true numbers). */
export function totalFindings(run: DesignPlaneResponse['deviance']['latest']): number | null {
  if (!run) return null
  const values = Object.values(run.counts ?? {}).filter((v): v is number => typeof v === 'number')
  return values.length ? values.reduce((a, b) => a + b, 0) : run.storedFindings
}

interface DesignLead {
  tone: PageStatusTone
  sentence: string
  metrics: PageStatusMetric[]
  next: 'fix-all' | 'run' | null
}

export function designLead(input: {
  latest: DesignPlaneResponse['deviance']['latest']
  lastError: DesignPlaneResponse['lastError']
  /** Files with findings in the stored rows. */
  files: number
  /** Token-file problems that are not format notes (errors and warnings). */
  tokenProblems: number
  formatNotes: number
}): DesignLead {
  const { latest, lastError, files, tokenProblems, formatNotes } = input
  const total = totalFindings(latest)
  const metrics: PageStatusMetric[] = []
  if (total) metrics.push({ label: total === 1 ? 'Hard-coded style' : 'Hard-coded styles', value: total.toLocaleString(), tone: 'warn' })
  if (files) metrics.push({ label: files === 1 ? 'File' : 'Files', value: files })
  if (latest?.score != null) metrics.push({ label: 'Drift score (lower is better)', value: Math.round(latest.score), hint: 'How much of the scanned code uses values outside your design, 0 to 100.' })
  if (lastError) {
    return { tone: 'danger', sentence: `The last design check failed: ${lastError.message.replace(/\.$/, '')}. Run it again.`, metrics, next: 'run' }
  }
  if (!latest) {
    return { tone: 'neutral', sentence: 'No drift check has run yet. Run one to find code that uses colours, sizes or fonts outside your design.', metrics, next: 'run' }
  }
  if (latest.status === 'error') {
    return { tone: 'warn', sentence: `The newest drift check could not finish${latest.error ? `: ${latest.error.replace(/\.$/, '')}` : ''}. Run it again.`, metrics, next: 'run' }
  }
  if (total && total > 0) {
    const tail = tokenProblems > 0 ? ` Your token files also have ${tokenProblems} problem${tokenProblems === 1 ? '' : 's'}.` : ''
    return {
      tone: latest.status === 'fail' ? 'danger' : 'warn',
      sentence: `${total.toLocaleString()} place${total === 1 ? '' : 's'} in ${files || 'your'} file${files === 1 ? '' : 's'} use a hard-coded style instead of your design tokens.${tail}`,
      metrics,
      next: files > 0 ? 'fix-all' : 'run',
    }
  }
  if (tokenProblems > 0) {
    return { tone: 'warn', sentence: `The code follows your design, but your token files have ${tokenProblems} problem${tokenProblems === 1 ? '' : 's'} to fix (listed below).`, metrics, next: null }
  }
  return {
    tone: 'ok',
    sentence: `The code follows your design tokens.${formatNotes > 0 ? ` ${formatNotes} token${formatNotes === 1 ? ' is' : 's are'} written in an older format; nothing is broken.` : ''}`,
    metrics,
    next: null,
  }
}
