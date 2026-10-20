/**
 * FILE: apps/admin/src/components/rewards/tabs/activityMetadata.ts
 * PURPOSE: Pure helpers that turn an activity event's metadata object into
 *   readable "key: value" pairs for the live feed. The raw JSON stays in the
 *   contributor detail view only.
 */

export interface MetadataPair {
  key: string
  /** `minutes_today` → "minutes today", `pageUrl` → "page url". */
  label: string
  value: string
}

function humanizeMetadataKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function formatMetadataValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(formatMetadataValue).join(', ')
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function metadataPairs(
  metadata: Record<string, unknown> | null | undefined,
): MetadataPair[] {
  if (!metadata || typeof metadata !== 'object') return []
  return Object.entries(metadata).map(([key, value]) => ({
    key,
    label: humanizeMetadataKey(key),
    value: formatMetadataValue(value),
  }))
}
