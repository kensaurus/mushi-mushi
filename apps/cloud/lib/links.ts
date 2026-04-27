/**
 * Central source-of-truth for outbound URLs used on the marketing landing.
 *
 * Why a single file?
 *   - Several CTAs (`Docs`, `Self-host guide`, every drawer "Learn the
 *     details" link) all need to point at the same docs root. Hardcoding
 *     `https://docs.mushimushi.dev` everywhere meant a rebrand or a
 *     subpath-deployment switch (e.g. moving docs to `kensaur.us/mushi-mushi/docs`
 *     while admin lives at `kensaur.us/mushi-mushi`) had to chase strings
 *     across `apps/cloud/app/page.tsx`, the canvas data file, the footer,
 *     and the drawer.
 *   - These are runtime values that legitimately differ between dev,
 *     preview, and prod hosting, so they belong in env, not in literals.
 *
 * Defaults are picked so that the page never renders a *truly* dead link in
 * dev: GitHub URLs always resolve, and `kensaur.us/mushi-mushi/docs` is the
 * deployment target the project is moving toward. If a doc page hasn't
 * shipped at the chosen domain yet, the docs route resolves to the GitHub
 * source tree where the same `.mdx` lives.
 */

const trimTrail = (s: string) => s.replace(/\/+$/, '')

/**
 * Public docs site root. Drawer links and `Docs` / `Self-host guide` CTAs
 * are computed from this base (e.g. `${docsUrl()}/quickstart`).
 *
 * Override with `NEXT_PUBLIC_DOCS_URL` per environment.
 */
export const docsUrl = (path = ''): string => {
  const base = trimTrail(
    process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://kensaur.us/mushi-mushi/docs',
  )
  if (!path) return base
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

/**
 * Canonical OSS repo. We expose a helper rather than hardcoding so the URL
 * tracks a single env override if you ever fork or move the canonical repo.
 */
export const repoUrl = (path = ''): string => {
  const base = trimTrail(
    process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/kensaurus/mushi-mushi',
  )
  if (!path) return base
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

/**
 * Sales / contact mailto. Defaults to the founder's personal address;
 * override with `NEXT_PUBLIC_CONTACT_EMAIL` once a branded inbox exists.
 */
export const contactEmail = (): string =>
  process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'kensaurus@gmail.com'

export const contactMailto = (subject?: string): string => {
  const addr = contactEmail()
  return subject ? `mailto:${addr}?subject=${encodeURIComponent(subject)}` : `mailto:${addr}`
}
