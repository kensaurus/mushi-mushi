/**
 * Canonical MCP server branding — icons, title, website.
 * Used by stdio + hosted HTTP initialize payloads (MCP 2025-11 icons spec).
 *
 * Cursor often shows the favicon of the HTTP URL host (e.g. supabase.co) when
 * server icons are absent. Always emit `icons` + recommend stdio or our icon URL.
 */

/** Public marketing site — also hosts favicon.svg for the docs app. */
export const MUSHI_WEBSITE_URL = 'https://kensaur.us/mushi-mushi'

/** 512×512 stamp mark — safe PNG on CDN (Cursor requires png/jpeg reliably). */
export const MUSHI_ICON_PNG_URL = `${MUSHI_WEBSITE_URL}/integrations/mushi-mark-512.png`

/** SVG favicon from the docs app (scalable; some clients sanitize SVG). */
export const MUSHI_ICON_SVG_URL = `${MUSHI_WEBSITE_URL}/favicon.svg`

/** Hosted MCP icon route — same origin as the MCP endpoint when proxied. */
export function mcpIconUrl(mcpBaseUrl: string): string {
  // Trim trailing slashes without a regex — `/\/+$/` is a polynomial-ReDoS
  // pattern (CodeQL js/polynomial-redos) on long all-slash inputs.
  let end = mcpBaseUrl.length
  while (end > 0 && mcpBaseUrl.charCodeAt(end - 1) === 47 /* '/' */) end--
  const base = mcpBaseUrl.slice(0, end)
  return `${base}?icon=1`
}

export interface McpIconDescriptor {
  src: string
  mimeType?: string
  /** MCP spec expects an array of size strings, e.g. `["512x512"]`. */
  sizes?: string[]
}

export const MUSHI_SERVER_ICONS: McpIconDescriptor[] = [
  { src: MUSHI_ICON_PNG_URL, mimeType: 'image/png', sizes: ['512x512'] },
  { src: MUSHI_ICON_SVG_URL, mimeType: 'image/svg+xml', sizes: ['any'] },
]

export const MUSHI_SERVER_METADATA = {
  name: 'mushi-mushi',
  title: 'Mushi Mushi',
  description:
    'User-felt bug triage, fix dispatch, QA stories, and inventory spec traceability for AI coding agents.',
  websiteUrl: MUSHI_WEBSITE_URL,
  icons: MUSHI_SERVER_ICONS,
} as const
