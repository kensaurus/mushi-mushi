/**
 * FILE: apps/admin/src/lib/streamdownSafety.ts
 * PURPOSE: Defense-in-depth link/image URL allowlist for Streamdown 2.x.
 *          Older Streamdown builds exposed allowedLinkPrefixes /
 *          allowedImagePrefixes; 2.5+ uses linkSafety + urlTransform.
 */

import type { LinkSafetyConfig, UrlTransform } from 'streamdown'

const LINK_PREFIXES = ['https://', 'http://', 'mailto:'] as const
const IMAGE_PREFIXES = ['https://', 'http://', 'data:image/'] as const

function startsWithAllowed(url: string, prefixes: readonly string[]): boolean {
  const trimmed = url.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('/')) return true
  return prefixes.some((p) => trimmed.toLowerCase().startsWith(p))
}

/** Confirm external navigations before opening (Streamdown linkSafety modal). */
export const STREAMDOWN_LINK_SAFETY: LinkSafetyConfig = {
  enabled: true,
  onLinkCheck: (url) => startsWithAllowed(url, LINK_PREFIXES),
}

/**
 * Drop javascript:/data: (non-image) / odd schemes from rendered hrefs & srcs.
 * Streamdown passes the raw URL through this hook before writing attributes.
 */
export const streamdownUrlTransform: UrlTransform = (url, key, _node) => {
  const value = String(url ?? '')
  if (key === 'src') {
    return startsWithAllowed(value, IMAGE_PREFIXES) ? value : ''
  }
  // href and anything else
  return startsWithAllowed(value, LINK_PREFIXES) ? value : ''
}
