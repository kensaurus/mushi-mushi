/**
 * FILE: apps/admin/src/lib/recipeTypes.ts
 * PURPOSE: Mirror of packages/server/supabase/functions/_shared/recipe-types.ts
 *          (App Recipe and design-plane wire types, Plan 019). Keep the two
 *          in step; the server file is the source of truth.
 *
 * Routes (all under adminOrApiKey; writes need mcp:write or an owner/admin JWT):
 *   GET  /v1/admin/projects/:id/recipe                    → RecipeResponse
 *   GET  /v1/admin/projects/:id/recipe/elements/:element  → RecipeElementDetail
 *   POST /v1/admin/projects/:id/recipe/refresh            → RecipeRefreshResult
 *   GET  /v1/admin/projects/:id/recipe/history            → RecipeHistoryResponse
 *   GET  /v1/admin/projects/:id/design[?direction=]       → DesignPlaneResponse
 *   GET  /v1/admin/projects/:id/design/tokens[?group=&type=&direction=] → DesignTokensResponse
 *   GET  /v1/admin/projects/:id/design/deviance[?limit=]  → DesignDevianceResponse
 *   POST /v1/admin/projects/:id/design/deviance/run       → DesignDevianceRunResult (202; run.status 'running', poll GET …/deviance)
 *   POST /v1/admin/projects/:id/design/changes            → DesignChangeResult
 *   GET  /v1/admin/projects/:id/design/excerpt[?files=]   → DesignExcerpt
 *   GET  /v1/admin/projects/:id/design/directions         → DesignDirectionsResponse
 *   GET  /v1/design-assets/:projectId?path=&exp=&sig=      → the asset bytes (HMAC-signed URL, no auth header)
 *
 * Every route answers `{ ok: true, data: <type> }`.
 */

// ── The five states ──────────────────────────────────────────────────────────

export const RECIPE_ELEMENT_KEYS = [
  'schema',
  'design',
  'routes',
  'gates',
  'ci',
  'deploy',
  'env',
  'integrations',
] as const
export type RecipeElementKey = (typeof RECIPE_ELEMENT_KEYS)[number]

/**
 * `unknown` means "configured but never observed, or observed too long ago".
 * It is never rendered as green. `not_connected` means nothing is configured.
 */
export type ElementState = 'ok' | 'drift' | 'unknown' | 'not_connected' | 'error'

export type RecipeLane = 'sources' | 'build' | 'deploy' | 'runtime'

export interface RecipeLink {
  label: string
  /** Console path (`/code-health`) or absolute https URL. */
  to: string
}

export interface RecipeElementSummary {
  key: RecipeElementKey
  label: string
  lane: RecipeLane
  state: ElementState
  /** One plain-English line: why this state. */
  reason: string
  lastCheckedAt: string | null
  /** A few key facts for the card (counts, versions, names). */
  facts: Record<string, string | number | boolean | null>
  findingsCount: number
  links: RecipeLink[]
}

export interface RecipeIssue {
  severity: 'info' | 'warn' | 'error'
  code: string
  message: string
  path?: string | null
  file?: string | null
}

export interface RecipeManifestStatus {
  present: boolean
  path: string | null
  commitSha: string | null
  capturedAt: string | null
  validationErrors: RecipeIssue[]
}

export interface RecipeResponse {
  projectId: string
  organizationId: string | null
  generatedAt: string
  /** Worst state across elements: error > drift > unknown > not_connected > ok. */
  worst: ElementState
  elements: Record<RecipeElementKey, RecipeElementSummary>
  manifest: RecipeManifestStatus
  snapshotHash: string | null
}

export interface RecipeElementDetail {
  element: RecipeElementSummary
  /**
   * Element-specific detail; shapes are documented per element in recipe.ts.
   * GET /recipe/elements/:element (never GET /recipe) adds one typed view:
   * `schemaView`, `ciView`, `deployView` or `envView` (below).
   */
  detail: Record<string, unknown>
}

// ── Per-element detail views (GET /recipe/elements/:element only) ───────────

export interface SchemaTableRow {
  name: string
  schema: string | null
  rls: boolean | null
  columns: number | null
}

export interface SchemaTableChange {
  name: string
  addedColumns: string[]
  removedColumns: string[]
  rls: { from: boolean | null; to: boolean | null } | null
}

export interface SchemaView {
  source: 'drift_scanner' | 'supabase_connector' | null
  capturedAt: string | null
  tables: SchemaTableRow[]
  totalTables: number
  diff: { previousCapturedAt: string; added: string[]; removed: string[]; changed: SchemaTableChange[] } | null
}

export interface CiRunRow {
  runId: number
  name: string | null
  event: string | null
  branch: string | null
  headSha: string | null
  status: string | null
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  estMinutes: number | null
  url: string | null
}

export interface CiView {
  runs: CiRunRow[]
  estMinutesTotal: number | null
  estimatedRuns: number
  note: string
}

export type DeployTargetStatus = 'live' | 'behind' | 'probe_failed' | 'unobserved' | 'not_comparable'

export interface DeployTargetRow {
  id: string
  kind: string | null
  environment: string | null
  probe: string | null
  expected: { commit: string | null; version: string | null }
  observed: { commit: string | null; version: string | null; at: string; ok: boolean; error: string | null; source: string } | null
  status: DeployTargetStatus
  reason: string
}

export interface DeployView {
  expectedCommit: string | null
  expectedVersion: string | null
  targets: DeployTargetRow[]
  undeclared: string[]
}

/** `not_checked`: the names there could not be listed, so nothing is claimed. */
export type EnvCell = 'present' | 'missing' | 'extra' | 'not_required' | 'not_checked'

export interface EnvMatrixColumn {
  key: string
  label: string
  checked: boolean
}

export interface EnvMatrixRow {
  name: string
  declared: boolean
  cells: Record<string, EnvCell>
}

export interface EnvView {
  columns: EnvMatrixColumn[]
  rows: EnvMatrixRow[]
  truncated: boolean
}

export interface RecipeRefreshResult {
  ok: boolean
  state: ElementState
  reason: string
  snapshotId: string | null
  tokensHash: string | null
  manifestPresent: boolean
  tokenCount: number
  issues: RecipeIssue[]
}

export interface RecipeHistoryEntry {
  id: string
  capturedAt: string
  commitSha: string | null
  source: 'repo_file' | 'ci_ingest' | 'derived' | 'connector'
  tokensHash: string
  isCurrent: boolean
  tokenCount: number
  validationErrorCount: number
}

export interface RecipeHistoryResponse {
  snapshots: RecipeHistoryEntry[]
  /** Token-level diff between the two newest snapshots (null when < 2). */
  latestDiff: TokenDiff | null
}

export interface TokenDiff {
  fromSnapshotId: string
  toSnapshotId: string
  added: string[]
  removed: string[]
  changed: Array<{ path: string; from: string; to: string }>
}

// ── Design tokens ────────────────────────────────────────────────────────────

/** DTCG 2025.10 `$type` values Mushi understands; anything else is kept as-is. */
export type TokenType =
  | 'color'
  | 'dimension'
  | 'fontFamily'
  | 'fontWeight'
  | 'duration'
  | 'cubicBezier'
  | 'number'
  | 'strokeStyle'
  | 'border'
  | 'transition'
  | 'shadow'
  | 'gradient'
  | 'typography'
  | string

export interface DesignToken {
  /** Dot-joined path, e.g. `color.action.primary`. */
  path: string
  type: TokenType | null
  /** Resolved, normalized 2025.10 value (aliases followed). */
  value: unknown
  /** Human display string: a `#RRGGBB` hex, `16px`, `IBM Plex Sans Thai Looped, sans-serif`, `220ms`. */
  display: string
  /** `#RRGGBB` (or `#RRGGBBAA`) for colors, else null. */
  hex: string | null
  /** Pixel value for px/rem dimensions (rem × 16), else null. */
  px: number | null
  /** Immediate alias target when the raw `$value` was `{a.b}`. */
  aliasOf: string | null
  cssVar: string | null
  ts: string | null
  rn: string | null
  description: string | null
  /** Repo path of the file that defines it. */
  file: string
  role: 'source' | 'export'
  /** First path segment (`color`, `space`, …). */
  group: string
}

export interface DesignTokenSet {
  name: string
  /** True for the set the manifest points at. */
  active: boolean
  /** `direction` for directions/<name>/, `export` for generated files, `default` otherwise. */
  kind: 'direction' | 'export' | 'default'
  files: Array<{ path: string; role: 'source' | 'export'; generator: string | null }>
  tokenCount: number
  /** design.directions[].note, when declared. */
  note?: string | null
}

export interface ContrastPairResult {
  fg: string
  bg: string
  fgHex: string | null
  bgHex: string | null
  ratio: number | null
  /** Required ratio: 4.5 (AA normal text) unless the pair declares `large` (3.0) or `min`. */
  min: number
  pass: boolean | null
  use: string | null
  /** Why ratio is null (unresolved token, non-color). */
  problem: string | null
}

export interface DesignComponentEntry {
  name: string
  file: string
}

export const DESIGN_RULE_IDS = [
  'off_token_color',
  'off_token_font',
  'off_scale_spacing',
  'off_scale_radius',
  'contrast_below_aa',
  'raw_interactive_element',
] as const
export type DesignRuleId = (typeof DESIGN_RULE_IDS)[number]

export type FindingSeverity = 'info' | 'warn' | 'error'

export interface DesignRuleConfig {
  id: DesignRuleId
  enabled: boolean
  severity: FindingSeverity
  /** Literal values never flagged by this rule (a hex such as `#RRGGBB`, `1px`). */
  allowValues: string[]
  /** File globs this rule skips. */
  allowFiles: string[]
  /** raw_interactive_element only: element → primitive component name. */
  primitives?: Record<string, string>
  /** True when the value comes from the repo's mushi.recipe.json, false for Mushi's default. */
  fromManifest: boolean
}

export interface DevianceBreakdownEntry {
  rule: DesignRuleId
  enabled: boolean
  /** False when the rule has nothing to judge (no contrast pairs declared). */
  applicable: boolean
  severity: FindingSeverity
  weight: number
  count: number
  /** Findings per 1,000 scanned lines (literal rules); failing share (contrast). */
  density: number | null
  /** 0..1 */
  penalty: number
}

export type DevianceRunStatus = 'running' | 'pass' | 'warn' | 'fail' | 'error'

export interface DevianceRun {
  runId: string
  status: DevianceRunStatus
  /** 0 (on-system) … 100 (off-system). Null when the scan could not judge anything. */
  score: number | null
  scannedFiles: number
  scannedLines: number
  /** Files that matched the scan globs before the cap was applied. */
  matchedFiles: number
  /** True when the file or byte cap stopped the scan early. */
  truncated: boolean
  commitSha: string | null
  startedAt: string
  completedAt: string | null
  breakdown: DevianceBreakdownEntry[]
  /** True finding counts per rule (stored rows are capped). */
  counts: Partial<Record<DesignRuleId, number>>
  storedFindings: number
  error: string | null
}

export interface DevianceSuggestion {
  token: string
  cssVar: string | null
  ts: string | null
  value: string
  /** Colour: OKLab ΔE×100; spacing/radius: px difference. */
  distance: number | null
}

export interface DevianceFinding {
  id?: string
  rule_id: DesignRuleId
  severity: FindingSeverity
  file_path: string | null
  line: number | null
  col: number | null
  value: string
  message: string
  suggestion: DevianceSuggestion | null
}

export interface DesignEditability {
  enabled: boolean
  /** Why editing is off: no manifest, export-only tokens, no GitHub token. */
  reason: string | null
  /** Repo paths a token edit may write (role: source ∩ change.allowPaths). */
  tokenFiles: string[]
  /** Whether mushi.recipe.json itself is writable (needed for rules edits). */
  manifestWritable: boolean
}

export interface DesignPlaneResponse {
  projectId: string
  state: ElementState
  reason: string
  snapshot: {
    id: string
    capturedAt: string
    commitSha: string | null
    source: RecipeHistoryEntry['source']
    tokensHash: string
  } | null
  manifest: RecipeManifestStatus
  sets: DesignTokenSet[]
  /** The set whose tokens are in `tokens` (query `direction`, else the active one). */
  shownSet: string | null
  activeSet: string | null
  tokens: DesignToken[]
  issues: RecipeIssue[]
  contrast: ContrastPairResult[]
  components: DesignComponentEntry[]
  /** design.css[] custom properties per scope: :root, @theme, and declared scopes (light/dark modes are scopes). */
  cssScopes: Array<{ path: string; selector: string; kind: 'root' | 'theme' | 'declared'; vars: Array<{ name: string; value: string; hex: string | null }> }>
  rules: DesignRuleConfig[]
  editable: DesignEditability
  deviance: {
    latest: DevianceRun | null
    trend: Array<{ at: string; score: number | null; status: DevianceRunStatus }>
    topFindings: DevianceFinding[]
  }
  /** Newest failed refresh or scan that is newer than the snapshot. */
  lastError: { at: string; message: string } | null
}

export interface DesignTokensResponse {
  projectId: string
  set: string | null
  tokens: DesignToken[]
  /** cssVar / ts name → token path, for agents writing code. */
  nameMap: Record<string, string>
  total: number
}

export interface DesignDevianceResponse {
  projectId: string
  latest: DevianceRun | null
  /** A scan still in progress (POST /deviance/run answers 202 and finishes in the background). */
  running: DevianceRun | null
  trend: Array<{ at: string; score: number | null; status: DevianceRunStatus }>
  findings: DevianceFinding[]
  rules: DesignRuleConfig[]
}

export interface DesignDevianceRunResult {
  refresh: RecipeRefreshResult
  run: DevianceRun | null
}

// ── Changes (always a draft PR, never a direct write) ───────────────────────

export interface TokenEdit {
  /** Token path in the active (or named) set. */
  path: string
  /** New value: `#RRGGBB` for colors, `12px` / `220ms` for dimensions and durations, a number, or a family list. */
  value: string | number | string[]
  set?: string
}

export type DesignChangeRequest =
  | { kind: 'tokens'; edits: TokenEdit[]; dryRun?: boolean; title?: string }
  | {
      kind: 'rules'
      rules: Partial<Record<DesignRuleId, Partial<Pick<DesignRuleConfig, 'enabled' | 'severity' | 'allowValues' | 'allowFiles' | 'primitives'>>>>
      dryRun?: boolean
      title?: string
    }
  /** Point mushi.recipe.json's source token files at another directions/<name>/ folder. */
  | { kind: 'activate'; direction: string; dryRun?: boolean; title?: string }
  /** Copy a direction's token files into directions/<name>/, optionally with token edits applied to the copy. */
  | { kind: 'duplicate'; from: string; name: string; displayName?: string; edits?: Array<Omit<TokenEdit, 'set'>>; dryRun?: boolean; title?: string }

export interface DesignFileChange {
  path: string
  /** Unified diff of the change (single hunk per edit region). */
  diff: string
  additions: number
  deletions: number
}

export interface DesignChangeResult {
  dryRun: boolean
  files: DesignFileChange[]
  /** Paths the change wanted to write but the allowlist refused. */
  denied: Array<{ path: string; reason: string }>
  pr: { url: string; number: number; branch: string; draft: true } | null
}

// ── Recipe changes from the console (gates, env, routes) ────────────────────
// Mirror of packages/server/supabase/functions/_shared/recipe-change.ts.
//   GET  /v1/admin/projects/:id/recipe/sources?element=   → RecipeSources
//   POST /v1/admin/projects/:id/recipe/changes            → RecipeChangeDryRun (dryRun) | RecipeChangeAccepted (202, wait:false)
//   GET  /v1/admin/projects/:id/recipe/changes/:jobId     → RecipeChangeJobRow
//   GET  /v1/admin/projects/:id/recipe/changes/:jobId/stream  → SSE `status` (RecipeChangeStreamStatus), `done`, `error`

export type RecipeChangeElement = 'design' | 'gates' | 'env' | 'routes' | 'store' | 'release'
/** The elements the side panel's Change tab edits. */
export type RecipeSourceElement = 'gates' | 'env' | 'routes'

export interface RecipeSourceFile {
  path: string
  exists: boolean
  /** null when absent, too large, or holding something shaped like a secret. */
  content: string | null
  /** Blob SHA to send back as `baseSha`; null when the file does not exist. */
  sha: string | null
  writable: boolean
  reason: string | null
}

export type RecipeSources =
  | { ok: true; element: RecipeSourceElement; branch: string; headSha: string; files: RecipeSourceFile[] }
  | { ok: false; element: RecipeSourceElement; reason: string; files: [] }

export interface RecipeChangeEdit {
  path: string
  content: string
  reason?: string
  /** The SHA the preview was read at; null = the file did not exist. The server refuses a file that moved since. */
  baseSha?: string | null
}

export interface RecipeChangeRequest {
  element: RecipeChangeElement
  edits: RecipeChangeEdit[]
  dryRun?: boolean
  /** false: answer 202 with a job id and open the PR in the background. */
  wait?: boolean
  title?: string
}

export interface RecipeChangeDryRun {
  dryRun: true
  ok: boolean
  reason: string | null
  files: DesignFileChange[]
  denied: Array<{ path: string; reason: string }>
}

export type RecipeChangeJobStatus = 'queued' | 'running' | 'pr_opened' | 'failed' | 'rejected'

export interface RecipeChangeAccepted {
  jobId: string
  projectId: string
  status: 'queued'
  prUrl: null
  error: null
}

export interface RecipeChangeJobRow {
  id: string
  element: RecipeChangeElement
  status: RecipeChangeJobStatus
  pr_url: string | null
  pr_number: number | null
  branch: string | null
  error: string | null
  batch_id: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface RecipeChangeStreamStatus {
  status: RecipeChangeJobStatus
  prUrl: string | null
  prNumber: number | null
  branch: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

// ── Excerpt for get_fix_context ──────────────────────────────────────────────

export interface DesignExcerpt {
  state: ElementState
  set: string | null
  /** Most useful tokens first (mapped semantic colours, type, spacing, radius). */
  tokens: Array<{ path: string; value: string; cssVar: string | null; ts: string | null }>
  /** Open deviance findings in the requested files. */
  findings: Array<{ file: string; line: number | null; rule: DesignRuleId; value: string; use: string | null }>
  score: number | null
  note: string
  truncated: boolean
}

// ── Directions board ─────────────────────────────────────────────────────────

export interface DirectionAsset {
  path: string
  kind: 'icon' | 'illustration' | 'image' | 'font' | 'lottie' | string
  /** Short-lived signed URL (relative to the api base, e.g. `/v1/design-assets/…`); null when it cannot be signed or is not an image. */
  url: string | null
  size: number | null
}

export interface DirectionFont {
  /** Token path, e.g. `font.family.display`. */
  path: string
  role: string
  families: string[]
}

export interface DesignDirection {
  /** Folder name under directions/. */
  name: string
  displayName: string
  /** Native-script name when the token file gives one, e.g. ผ้าคราม. */
  nativeName: string | null
  concept: string | null
  active: boolean
  /** design.directions[].note, when declared. */
  note: string | null
  /** Inactive directions are read-only comparison sets: never scanned, never edited by a recipe PR. */
  readOnly: boolean
  files: Array<{ path: string; role: 'source' | 'export'; generator: string | null }>
  tokenCount: number
  /** Every normalized token of the direction (the board picks roles from these). */
  tokens: DesignToken[]
  issues: RecipeIssue[]
  /** Declared contrast pairs (mushi.recipe.json design.contrast) computed against this direction. */
  contrast: ContrastPairResult[]
  fonts: DirectionFont[]
  /** motion.* tokens (durations, easings) as display strings. */
  motion: Array<{ path: string; display: string }>
  /** Line and shape tokens: border.*, radius.*, line colours. */
  line: Array<{ path: string; display: string }>
  assets: DirectionAsset[]
  /** Latest deviance run; only the active direction is ever scanned. */
  deviance: { score: number | null; status: DevianceRunStatus; at: string } | null
}

export interface DesignDirectionsResponse {
  projectId: string
  activeDirection: string | null
  directions: DesignDirection[]
  /** One Google Fonts css2 stylesheet URL per declared non-generic family; a family Google does not serve simply fails to load. */
  fontStylesheets: string[]
  /** Specimen text in the project's script, detected from the declared font families (Thai for glot). */
  specimen: { script: 'thai' | 'japanese' | 'korean' | 'chinese' | 'arabic' | 'devanagari' | 'latin'; sample: string; word: string; latin: string }
  editable: { enabled: boolean; reason: string | null }
}
