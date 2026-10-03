/**
 * FILE: packages/server/supabase/functions/_shared/connectors/canonical.ts
 * PURPOSE: One canonical JSON form (keys sorted at every level) so an
 *          approval's SHA-256 binds the exact payload, whatever key order the
 *          caller used.
 */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}
