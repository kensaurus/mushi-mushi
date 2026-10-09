/**
 * The docs route for the current URL, including the landing alias.
 *
 * The static export (basePath /mushi-mushi/docs) is also served at its parent
 * path /mushi-mushi/ as the product landing — a CloudFront rewrite to
 * docs/index.html (scripts/cloudfront-mushi-spa-router.js). There
 * `usePathname()` returns the raw "/mushi-mushi/" because it is outside
 * basePath, so anything keyed on "/" treated the landing as an unknown page:
 * the footer showed the portfolio the landing hides (a hydration mismatch,
 * React #418), and analytics recorded every landing visit as a
 * docs_page_view on "/mushi-mushi" — landing_view never fired.
 *
 * NEXT_PUBLIC_MUSHI_ROOT_ALIAS is set by next.config.mjs (the basePath's
 * parent) and is empty outside the production build. Nextra's own route
 * hook gets the same mapping via patches/nextra@4.6.1.patch.
 *
 * Callers use `toSitePathname(usePathname())`.
 */
const ROOT_ALIAS = process.env.NEXT_PUBLIC_MUSHI_ROOT_ALIAS ?? ''

export function toSitePathname<P extends string | null>(pathname: P, rootAlias: string = ROOT_ALIAS): P | '/' {
  if (!pathname || !rootAlias) return pathname
  if (pathname === rootAlias || pathname === `${rootAlias}/`) return '/'
  return pathname
}
