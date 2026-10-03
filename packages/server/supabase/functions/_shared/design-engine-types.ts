/**
 * FILE: packages/server/supabase/functions/_shared/design-engine-types.ts
 * PURPOSE: The types the design deviance engine runs on: tokens, rules,
 *          findings and contrast pairs. recipe-types.ts re-exports every one,
 *          so route code keeps importing from there.
 *
 * The engine (this file, design-color, dtcg, design-deviance, design-rules,
 * design-set-plan, design-scan and recipe-glob) also runs in the host's CI as
 * `mushi recipe check`, so the CLI and the server produce the same findings
 * and the same score. Each engine file is kept byte-identical in
 * packages/cli/src/recipe/engine/ (asserted by
 * packages/server/src/__tests__/design-engine-parity.test.ts). Edit both
 * together. Engine files import only each other, never npm: or Deno modules.
 */

export interface RecipeIssue {
  severity: 'info' | 'warn' | 'error'
  code: string
  message: string
  path?: string | null
  file?: string | null
}

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

/** `direction` for directions/<name>/, `export` for generated files, `default` otherwise. */
export type TokenSetKind = 'direction' | 'export' | 'default'

/** One `design.contrast[]` entry of mushi.recipe.json. */
export interface ContrastPairDecl {
  fg: string
  bg: string
  /** Required ratio; defaults to 4.5 (AA normal text), or 3 when `large`. */
  min?: number
  large?: boolean
  use?: string
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
