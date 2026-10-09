/**
 * FILE: packages/server/supabase/functions/_shared/design-scan.ts
 * PURPOSE: One deviance scan from a manifest, its tokens and file texts: which
 *          files are read, the findings, and the 0–100 score. The server scan
 *          (design-plane.ts executeScan), the CI push (POST /v1/ingest/recipe)
 *          and `mushi recipe check` all go through these functions, so the
 *          three can never disagree on a rule id, a finding or a score.
 *
 * Engine file: kept byte-identical in packages/cli/src/recipe/engine/
 * (see design-engine-types.ts).
 */

import {
  buildDevianceContext,
  computeDevianceScore,
  contrastFindings,
  evaluateContrast,
  LITERAL_RULES,
  ruleApplicable,
  scanSourceFile,
  sortFindings,
} from './design-deviance.ts'
import type { ContrastPairDecl, DesignRuleId, DesignToken, DevianceBreakdownEntry, DevianceFinding, RecipeIssue, TokenSetKind } from './design-engine-types.ts'
import { effectiveDesignRules, type DesignRulesManifest } from './design-rules.ts'
import { judgingSet, MAX_TOKEN_FILE_BYTES, planTokenSets, type DeclaredDirection, type PlannedSet } from './design-set-plan.ts'
import { normalizeTokenSet } from './dtcg.ts'
import { matchAny } from './recipe-glob.ts'

/** Scan bounds: files, total bytes, bytes per file, stored finding rows. */
export const SCAN_LIMITS = { maxFiles: 1500, maxBytes: 12 * 1024 * 1024, maxFileBytes: 256 * 1024, maxStoredFindings: 500 }
export const DEFAULT_SCAN_GLOBS = ['**/*.{css,scss,ts,tsx,js,jsx}']
export const ALWAYS_IGNORE = [
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/out/**', '**/coverage/**', '**/vendor/**',
  '**/*.d.ts', '**/*.min.*', '**/*.map', '**/*.generated.*', '**/android/**', '**/ios/**',
]

/** The part of mushi.recipe.json a scan reads. */
export interface DesignScanManifest {
  design?: NonNullable<DesignRulesManifest['design']> & {
    tokens?: ReadonlyArray<{ path: string; role: 'source' | 'export'; generator?: string }>
    directions?: readonly DeclaredDirection[]
    components?: { globs?: readonly string[] }
    literalScan?: { globs?: readonly string[]; ignore?: readonly string[] }
    contrast?: readonly ContrastPairDecl[]
  }
}

/** The token sets a scan judges against (the stored snapshot's `tokens` has this shape and more). */
export interface ScanTokens {
  sets: ReadonlyArray<{ name: string; active: boolean; kind: TokenSetKind; files: PlannedSet['files']; tokens: DesignToken[] }>
}

export interface ScanInput {
  manifest: DesignScanManifest | null
  tokens: ScanTokens | null
}

/** Files the scan reads, in a fixed order, plus whether a cap cut it short. */
export function selectScanFiles(
  entries: ReadonlyArray<{ path: string; size: number }>,
  manifest: DesignScanManifest | null,
  excludePaths: readonly string[],
  limits = SCAN_LIMITS,
): { files: string[]; matched: number; truncated: boolean } {
  const declared = manifest?.design?.literalScan?.globs
  const globs = declared && declared.length > 0 ? [...declared] : DEFAULT_SCAN_GLOBS
  const ignore = [...ALWAYS_IGNORE, ...(manifest?.design?.literalScan?.ignore ?? [])]
  const matched = entries
    .filter((e) => matchAny(e.path, globs) && !matchAny(e.path, ignore) && !excludePaths.includes(e.path) && e.size <= limits.maxFileBytes)
    .sort((a, b) => (a.path < b.path ? -1 : 1))
  const files: string[] = []
  let bytes = 0
  for (const e of matched) {
    if (files.length >= limits.maxFiles || bytes + e.size > limits.maxBytes) break
    files.push(e.path)
    bytes += e.size
  }
  return { files, matched: matched.length, truncated: files.length < matched.length }
}

/** Every token file the sets name; the scan never judges a token file against itself. */
export function tokenFilePaths(tokens: ScanTokens | null): string[] {
  return (tokens?.sets ?? []).flatMap((s) => s.files.map((f) => f.path))
}

/** What the literal rules found over the scanned files. */
export interface LiteralScan {
  counts: Partial<Record<DesignRuleId, number>>
  scannedLines: number
  scannedFiles: number
}

export interface DevianceScore {
  /** Contrast findings, judged from the tokens alone. */
  contrastFindings: DevianceFinding[]
  /** Literal counts plus the contrast count. */
  counts: Partial<Record<DesignRuleId, number>>
  score: number | null
  breakdown: DevianceBreakdownEntry[]
}

/**
 * Contrast and the score from literal counts. The CI push calls this with the
 * counts `mushi recipe check` sent; computeDeviance calls it with its own.
 */
export function scoreDeviance(input: ScanInput, literal: LiteralScan): DevianceScore {
  const tokens = judgingSet(input.tokens)?.tokens ?? []
  const rules = effectiveDesignRules(input.manifest)
  const ctx = buildDevianceContext(tokens, rules, input.manifest?.design?.components?.globs ?? [])
  const contrast = evaluateContrast(tokens, input.manifest?.design?.contrast ?? [])
  const found = contrastFindings(contrast, tokens, rules.find((r) => r.id === 'contrast_below_aa'))
  const counts: Partial<Record<DesignRuleId, number>> = {}
  for (const r of LITERAL_RULES) if (literal.counts[r]) counts[r] = literal.counts[r]
  if (found.length > 0) counts.contrast_below_aa = found.length
  const judged = contrast.filter((c) => c.pass !== null)
  const applicable: Partial<Record<DesignRuleId, boolean>> = {}
  for (const r of [...LITERAL_RULES, 'contrast_below_aa' as const]) applicable[r] = ruleApplicable(r, ctx, judged.length)
  const { score, breakdown } = computeDevianceScore({
    rules,
    counts,
    scannedLines: literal.scannedLines,
    scannedFiles: literal.scannedFiles,
    applicable,
    contrast: { declared: judged.length, failing: judged.filter((c) => c.pass === false).length },
  })
  return { contrastFindings: found, counts, score, breakdown }
}

export interface DevianceComputation {
  findings: DevianceFinding[]
  counts: Partial<Record<DesignRuleId, number>>
  score: number | null
  breakdown: DevianceBreakdownEntry[]
  scannedLines: number
  scannedFiles: number
}

/** Everything a deviance run computes from the manifest, its tokens and the file texts (null = unreadable). */
export function computeDeviance(input: ScanInput, texts: ReadonlyMap<string, string | null>): DevianceComputation {
  const tokens = judgingSet(input.tokens)?.tokens ?? []
  const rules = effectiveDesignRules(input.manifest)
  const ctx = buildDevianceContext(tokens, rules, input.manifest?.design?.components?.globs ?? [])
  const literal: DevianceFinding[] = []
  let scannedLines = 0
  let scannedFiles = 0
  for (const [path, text] of texts) {
    if (text == null) continue
    const r = scanSourceFile(path, text, ctx)
    scannedLines += r.lines
    scannedFiles++
    literal.push(...r.findings)
  }
  const literalCounts: Partial<Record<DesignRuleId, number>> = {}
  for (const f of literal) literalCounts[f.rule_id] = (literalCounts[f.rule_id] ?? 0) + 1
  const scored = scoreDeviance(input, { counts: literalCounts, scannedLines, scannedFiles })
  return {
    findings: sortFindings([...literal, ...scored.contrastFindings]),
    counts: scored.counts,
    score: scored.score,
    breakdown: scored.breakdown,
    scannedLines,
    scannedFiles,
  }
}

/** A file as the local checkout reads it. */
export type LocalFile = { kind: 'file'; text: string } | { kind: 'absent' } | { kind: 'too_large'; size: number }

/**
 * The judging tokens from a local checkout, read the way the server's
 * snapshot reads them: the same set plan, the same per-file cap, the same
 * normalizer. Only the active and export sets are read (judgingSet never
 * picks another).
 */
export function readScanTokens(
  manifest: DesignScanManifest,
  treePaths: readonly string[],
  readFile: (path: string, maxBytes: number) => LocalFile,
): { tokens: ScanTokens; issues: RecipeIssue[] } {
  const plan = planTokenSets(manifest.design?.tokens ?? [], treePaths, manifest.design?.directions ?? [])
  const issues: RecipeIssue[] = [...plan.issues]
  const sets: ScanTokens['sets'][number][] = []
  for (const set of plan.sets) {
    if (!set.active && set.kind !== 'export') {
      sets.push({ name: set.name, active: set.active, kind: set.kind, files: set.files, tokens: [] })
      continue
    }
    const files: Array<{ path: string; role: 'source' | 'export'; text: string }> = []
    for (const f of set.files) {
      const file = readFile(f.path, MAX_TOKEN_FILE_BYTES)
      if (file.kind === 'absent') {
        issues.push({ severity: set.active ? 'error' : 'warn', code: 'TOKEN_FILE_MISSING', message: `${f.path} is listed but does not exist.`, file: f.path })
        continue
      }
      if (file.kind === 'too_large') {
        issues.push({ severity: 'error', code: 'TOKEN_FILE_TOO_LARGE', message: `${f.path} is ${file.size} bytes; the cap is ${MAX_TOKEN_FILE_BYTES}.`, file: f.path })
        continue
      }
      files.push({ path: f.path, role: f.role, text: file.text })
    }
    const norm = normalizeTokenSet(files)
    issues.push(...norm.issues)
    sets.push({ name: set.name, active: set.active, kind: set.kind, files: set.files, tokens: norm.tokens })
  }
  return { tokens: { sets }, issues }
}
