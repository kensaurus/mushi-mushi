/** Deno copy of packages/mcp/src/branding.ts — keep in sync. */

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

export const SERVER_INFO_EXTENDED = {
  name: 'mushi-mushi',
  title: 'Mushi Mushi',
  version: '2.0.0',
  websiteUrl: MUSHI_WEBSITE_URL,
  icons: [...MUSHI_SERVER_ICONS],
} as const
