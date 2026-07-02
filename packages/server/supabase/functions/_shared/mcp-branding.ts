/** Deno copy of packages/mcp/src/branding.ts — keep in sync. */

import { DEPLOY_INFO } from './deploy-info.ts'

export const MUSHI_WEBSITE_URL = 'https://kensaur.us/mushi-mushi'
export const MUSHI_ICON_PNG_URL = `${MUSHI_WEBSITE_URL}/integrations/mushi-mark-512.png`
export const MUSHI_ICON_SVG_URL = `${MUSHI_WEBSITE_URL}/favicon.svg`

/** Inline stamp mark — served at ?icon=1 when CDN is unreachable. */
export const MUSHI_ICON_SVG_INLINE = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100"><rect x="8" y="8" width="84" height="84" rx="12" fill="#E03C2C"/><text x="50" y="78" text-anchor="middle" fill="#F8F4ED" font-family="serif" font-weight="700" font-size="62">虫</text></svg>`

export function mcpIconUrl(mcpBaseUrl: string): string {
  const base = mcpBaseUrl.replace(/\/+$/, '')
  return `${base}?icon=1`
}

export const MUSHI_SERVER_ICONS = [
  { src: MUSHI_ICON_PNG_URL, mimeType: 'image/png', sizes: ['512x512'] },
  { src: MUSHI_ICON_SVG_URL, mimeType: 'image/svg+xml', sizes: ['any'] },
] as const

// Bump on a hosted-MCP protocol or tool-catalog change worth a human-visible
// version bump. The deployed commit's short SHA is appended below (when
// available) so clients can tell two deploys apart even between base-version
// bumps — see deploy-info.ts docblock for why the hosted transport needs
// this instead of reading package.json the way stdio does.
const BASE_VERSION = '2.0.0'
const shortSha = DEPLOY_INFO.sha !== 'dev' ? DEPLOY_INFO.sha.slice(0, 7) : null

export const SERVER_INFO_EXTENDED = {
  name: 'mushi-mushi',
  title: 'Mushi Mushi',
  version: shortSha ? `${BASE_VERSION}+${shortSha}` : BASE_VERSION,
  websiteUrl: MUSHI_WEBSITE_URL,
  icons: [...MUSHI_SERVER_ICONS],
} as const
