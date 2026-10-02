/**
 * FILE: packages/server/supabase/functions/_shared/recipe-schema.ts
 * PURPOSE: `mushi.recipe.json` (Plan 019 §2): parse, validate and answer the
 *          two security questions the design plane asks of it —
 *            1. which design rules apply (with Mushi's defaults underneath),
 *            2. may a recipe PR write this path (`isWritablePath`).
 *
 * The manifest is untrusted repo content: it is size-capped, secret-scanned,
 * Zod-validated, and unknown keys are kept but ignored (`passthrough`).
 */

import { z } from 'npm:zod@3'
import { matchAny, matchGlob, normalizeRepoPath } from './recipe-glob.ts'
import { scanForSecrets } from './secret-scan.ts'
import type { DesignRuleConfig, DesignRuleId, FindingSeverity, RecipeIssue } from './recipe-types.ts'
import { DESIGN_RULE_IDS } from './recipe-types.ts'

export const RECIPE_MANIFEST_PATH = 'mushi.recipe.json'
export const RECIPE_MANIFEST_MAX_BYTES = 64 * 1024

const repoPath = z.string().min(1).max(512)
const severity = z.enum(['info', 'warn', 'error'])

const tokenFileSchema = z
  .object({
    path: repoPath,
    role: z.enum(['source', 'export']),
    format: z.string().optional(),
    generator: z.string().max(200).optional(),
  })
  .passthrough()

const directionSchema = z
  .object({
    name: z.string().min(1).max(80),
    status: z.enum(['active', 'inactive']),
    tokens: z.array(repoPath).min(1).max(20),
    note: z.string().max(500).optional(),
  })
  .passthrough()

const contrastPairSchema = z
  .object({
    fg: z.string().min(1).max(200),
    bg: z.string().min(1).max(200),
    /** Required ratio; defaults to 4.5 (AA normal text), or 3 when `large`. */
    min: z.number().min(1).max(21).optional(),
    large: z.boolean().optional(),
    use: z.string().max(200).optional(),
  })
  .passthrough()

const ruleSchema = z
  .object({
    enabled: z.boolean().optional(),
    severity: severity.optional(),
    allowValues: z.array(z.string().max(100)).max(200).optional(),
    allowFiles: z.array(z.string().max(300)).max(100).optional(),
    primitives: z.record(z.string().max(40), z.string().max(80)).optional(),
  })
  .passthrough()

const designSchema = z
  .object({
    tokens: z.array(tokenFileSchema).max(40).optional(),
    css: z
      .array(
        z
          .object({
            path: repoPath,
            role: z.string().optional(),
            /** Selectors whose custom properties count, besides :root and @theme. */
            scopes: z.array(z.string().min(1).max(300)).max(20).optional(),
          })
          .passthrough(),
      )
      .max(20)
      .optional(),
    /** Candidate directions for comparison; tokens[] stays the only drift source. */
    directions: z.array(directionSchema).max(20).optional(),
    components: z.object({ globs: z.array(z.string().max(300)).max(40) }).passthrough().optional(),
    literalScan: z
      .object({
        globs: z.array(z.string().max(300)).max(40).optional(),
        ignore: z.array(z.string().max(300)).max(80).optional(),
      })
      .passthrough()
      .optional(),
    assets: z.array(z.object({ path: repoPath, kind: z.string().optional(), direction: z.string().max(80).optional() }).passthrough()).max(40).optional(),
    contrast: z.array(contrastPairSchema).max(100).optional(),
    rules: z.record(z.string(), ruleSchema).optional(),
  })
  .passthrough()

export const recipeManifestSchema = z
  .object({
    version: z.literal(1),
    app: z.object({ name: z.string().max(120).optional() }).passthrough().optional(),
    design: designSchema.optional(),
    data: z.object({ migrationsDir: repoPath.optional() }).passthrough().optional(),
    gates: z
      .object({
        budgets: z.record(z.string(), z.number()).optional(),
        cadence: z.record(z.string(), z.string().max(20)).optional(),
      })
      .passthrough()
      .optional(),
    change: z.object({ allowPaths: z.array(z.string().max(300)).max(100).optional() }).passthrough().optional(),
  })
  .passthrough()

export type RecipeManifest = z.infer<typeof recipeManifestSchema>
export type ContrastPairDecl = z.infer<typeof contrastPairSchema>
export type DirectionDecl = z.infer<typeof directionSchema>

/**
 * `design.directions[]` rules (Plan 019 §2): at most one direction is active,
 * and its `tokens` must equal the `role: "source"` paths of `design.tokens[]`
 * exactly, so the board can never disagree with what drift checks.
 */
export function checkDirections(manifest: RecipeManifest): RecipeIssue[] {
  const dirs = (manifest.design?.directions ?? []) as DirectionDecl[]
  if (dirs.length === 0) return []
  const issues: RecipeIssue[] = []
  const active = dirs.filter((d) => d.status === 'active')
  const names = new Set<string>()
  for (const d of dirs) {
    if (names.has(d.name)) issues.push({ severity: 'error', code: 'directions_duplicate_name', message: `design.directions has two entries named "${d.name}".`, file: RECIPE_MANIFEST_PATH })
    names.add(d.name)
    for (const t of d.tokens) {
      if (!normalizeRepoPath(t)) issues.push({ severity: 'error', code: 'UNSAFE_PATH', message: `design.directions "${d.name}" lists "${t}", which is not a safe repo path.`, file: RECIPE_MANIFEST_PATH })
    }
  }
  if (active.length > 1) {
    issues.push({ severity: 'error', code: 'directions_active_mismatch', message: `design.directions marks ${active.length} directions active (${active.map((d) => d.name).join(', ')}); at most one may be.`, file: RECIPE_MANIFEST_PATH })
    return issues
  }
  if (active.length === 1) {
    const want = new Set((manifest.design?.tokens ?? []).filter((t) => t.role === 'source').map((t) => normalizeRepoPath(t.path) ?? t.path))
    const got = new Set(active[0].tokens.map((t) => normalizeRepoPath(t) ?? t))
    const same = want.size === got.size && [...want].every((p) => got.has(p))
    if (!same) {
      issues.push({
        severity: 'error',
        code: 'directions_active_mismatch',
        message: `The active direction "${active[0].name}" lists different files from the role: "source" entries in design.tokens. They must be the same set.`,
        file: RECIPE_MANIFEST_PATH,
      })
    }
  }
  return issues
}

export type ManifestParse =
  | { ok: true; manifest: RecipeManifest; issues: RecipeIssue[] }
  | { ok: false; issues: RecipeIssue[] }

/** Parse the raw file text. Never throws. */
export function parseRecipeManifest(text: string): ManifestParse {
  const bytes = new TextEncoder().encode(text).length
  if (bytes > RECIPE_MANIFEST_MAX_BYTES) {
    return {
      ok: false,
      issues: [{ severity: 'error', code: 'MANIFEST_TOO_LARGE', message: `mushi.recipe.json is ${bytes} bytes; the cap is ${RECIPE_MANIFEST_MAX_BYTES}.`, file: RECIPE_MANIFEST_PATH }],
    }
  }
  const secret = scanForSecrets(text)
  if (secret) {
    return {
      ok: false,
      issues: [{ severity: 'error', code: 'SECRET_DETECTED', message: `mushi.recipe.json contains something shaped like a ${secret}; the manifest was not stored. Remove it and refresh.`, file: RECIPE_MANIFEST_PATH }],
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      issues: [{ severity: 'error', code: 'MANIFEST_INVALID_JSON', message: `mushi.recipe.json is not valid JSON: ${String(err).slice(0, 160)}`, file: RECIPE_MANIFEST_PATH }],
    }
  }
  const parsed = recipeManifestSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 20).map((i) => ({
        severity: 'error' as const,
        code: 'MANIFEST_SCHEMA',
        message: `${i.path.join('.') || '(root)'}: ${i.message}`,
        path: i.path.join('.') || null,
        file: RECIPE_MANIFEST_PATH,
      })),
    }
  }
  const directionIssues = checkDirections(parsed.data)
  if (directionIssues.some((i) => i.severity === 'error')) return { ok: false, issues: directionIssues }
  const issues: RecipeIssue[] = []
  for (const tf of parsed.data.design?.tokens ?? []) {
    if (!normalizeRepoPath(tf.path)) {
      issues.push({ severity: 'error', code: 'UNSAFE_PATH', message: `design.tokens path "${tf.path}" is not a safe repo path and is ignored.`, file: RECIPE_MANIFEST_PATH })
    }
  }
  for (const key of Object.keys(parsed.data.design?.rules ?? {})) {
    if (!(DESIGN_RULE_IDS as readonly string[]).includes(key)) {
      issues.push({ severity: 'info', code: 'UNKNOWN_RULE', message: `design.rules.${key} is not a rule Mushi knows; it is ignored.`, file: RECIPE_MANIFEST_PATH })
    }
  }
  return { ok: true, manifest: parsed.data, issues }
}

// ── Design rules ─────────────────────────────────────────────────────────────

/** Mushi's defaults. raw_interactive_element is opt-in because it needs primitives. */
export const DEFAULT_DESIGN_RULES: Readonly<Record<DesignRuleId, { enabled: boolean; severity: FindingSeverity; allowValues: string[] }>> = {
  off_token_color: { enabled: true, severity: 'warn', allowValues: [] },
  off_token_font: { enabled: true, severity: 'warn', allowValues: [] },
  off_scale_spacing: { enabled: true, severity: 'info', allowValues: ['0', '0px'] },
  off_scale_radius: { enabled: true, severity: 'info', allowValues: ['0', '0px', '50%', '100%'] },
  contrast_below_aa: { enabled: true, severity: 'error', allowValues: [] },
  raw_interactive_element: { enabled: false, severity: 'info', allowValues: [] },
}

/** Manifest rules layered over the defaults, in DESIGN_RULE_IDS order. */
export function effectiveDesignRules(manifest: RecipeManifest | null): DesignRuleConfig[] {
  const declared = (manifest?.design?.rules ?? {}) as Record<string, z.infer<typeof ruleSchema>>
  return DESIGN_RULE_IDS.map((id) => {
    const d = DEFAULT_DESIGN_RULES[id]
    const m = declared[id]
    const cfg: DesignRuleConfig = {
      id,
      enabled: m?.enabled ?? d.enabled,
      severity: m?.severity ?? d.severity,
      allowValues: m?.allowValues ?? d.allowValues,
      allowFiles: m?.allowFiles ?? [],
      fromManifest: m !== undefined,
    }
    if (id === 'raw_interactive_element') cfg.primitives = m?.primitives ?? {}
    return cfg
  })
}

// ── The write allowlist (Plan 019 §2 `change`, §6) ──────────────────────────

const ALWAYS_DENIED: ReadonlyArray<{ glob: string; reason: string }> = [
  { glob: '.git/**', reason: 'git internals' },
  { glob: '.github/**', reason: 'workflow files need the workflow scope and are off in v1' },
  { glob: '**/.github/**', reason: 'workflow files need the workflow scope and are off in v1' },
  { glob: '{**/,}{pnpm-lock.yaml,package-lock.json,yarn.lock,bun.lockb,deno.lock,Cargo.lock,Gemfile.lock,poetry.lock,composer.lock}', reason: 'lockfiles are never edited by Mushi' },
  { glob: '**/*.{png,jpg,jpeg,gif,webp,avif,ico,pdf,zip,gz,woff,woff2,ttf,otf,mp4,mov,mp3,wasm,jar,keystore,p8,p12,pem,key}', reason: 'binary or key material' },
]

function isEnvFile(path: string): boolean {
  const base = path.split('/').pop() ?? ''
  return base.startsWith('.env') && base !== '.env.example'
}

export type WritableCheck = { ok: true; path: string } | { ok: false; path: string; reason: string }

/**
 * May a recipe PR write `path`? Deny rules always beat `change.allowPaths`.
 * `scope` narrows further: the design plane passes the manifest plus the
 * declared `role: "source"` token files, so a design PR can never touch code.
 */
export function isWritablePath(
  rawPath: string,
  manifest: RecipeManifest | null,
  scope?: readonly string[],
): WritableCheck {
  const path = normalizeRepoPath(rawPath)
  if (!path) return { ok: false, path: rawPath, reason: 'not a safe repo-relative path' }
  if (!manifest) return { ok: false, path, reason: 'the repo has no valid mushi.recipe.json, so nothing is writable' }
  for (const d of ALWAYS_DENIED) {
    if (matchGlob(path, d.glob)) return { ok: false, path, reason: d.reason }
  }
  if (isEnvFile(path)) return { ok: false, path, reason: 'env files hold secret values and are never written' }
  const exports = (manifest.design?.tokens ?? []).filter((t) => t.role === 'export').map((t) => normalizeRepoPath(t.path))
  if (exports.includes(path)) {
    return { ok: false, path, reason: 'this token file is a generated export; edit its source instead' }
  }
  const migrations = manifest.data?.migrationsDir ? normalizeRepoPath(manifest.data.migrationsDir.replace(/\/+$/, '')) : null
  if (migrations && (path === migrations || path.startsWith(`${migrations}/`))) {
    return { ok: false, path, reason: 'migration files are a later per-project opt-in' }
  }
  if (scope && !scope.includes(path)) {
    return { ok: false, path, reason: 'outside what this change may touch (token source files and mushi.recipe.json)' }
  }
  const allow = manifest.change?.allowPaths ?? []
  if (allow.length === 0) return { ok: false, path, reason: 'mushi.recipe.json declares no change.allowPaths' }
  if (!matchAny(path, allow)) return { ok: false, path, reason: 'not matched by change.allowPaths in mushi.recipe.json' }
  return { ok: true, path }
}
