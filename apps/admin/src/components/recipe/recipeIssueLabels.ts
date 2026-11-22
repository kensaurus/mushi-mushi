/**
 * FILE: apps/admin/src/components/recipe/recipeIssueLabels.ts
 * PURPOSE: Plain words for token-file and recipe-file issue codes (owner, 2026-11-19: the
 *          Design page led with "legacy_color_string ×43"). The code stays available as a
 *          tooltip for people who search the docs; it never leads.
 *          Codes: _shared/dtcg.ts (token files) and _shared/recipe-manifest (mushi.recipe.json).
 */

const LABEL: Record<string, string> = {
  legacy_color_string: 'Colour written as plain text',
  legacy_dimension_string: 'Size written as plain text',
  legacy_duration_string: 'Duration written as plain text',
  hex_shorthand: 'Short hex colour',
  color_unparseable: 'Colour that cannot be read',
  color_space_approximated: 'Wide-gamut colour shown as sRGB',
  unitless_number: 'Number with no unit',
  token_nonconformant: 'Dot inside a token name',
  token_missing_type: 'Token with no type',
  token_duplicate: 'Token defined twice',
  alias_unresolved: 'Alias to a token that does not exist',
  alias_cycle: 'Aliases that point at each other',
  token_file_invalid_json: 'Token file is not valid JSON',
  token_file_not_object: 'Token file is not a JSON object',
  dimension_unparseable: 'Size that cannot be read',
  duration_unparseable: 'Duration that cannot be read',
  cubicBezier_unparseable: 'Easing curve that cannot be read',
  MANIFEST_MISSING: 'No mushi.recipe.json at the repo root',
}

/** Plain words for an issue code; an unknown code reads as its words ("some_code" → "Some code"). */
export function issueCodeLabel(code: string): string {
  if (Object.prototype.hasOwnProperty.call(LABEL, code)) return LABEL[code]!
  const words = code.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code
}

/**
 * Format notes: info-level issues that only say a token is written in an older DTCG form. The
 * tokens still work, so the Design page folds them into one row instead of leading with them.
 */
export function isFormatNote(issue: { severity: string; code: string }): boolean {
  return issue.severity === 'info'
}
