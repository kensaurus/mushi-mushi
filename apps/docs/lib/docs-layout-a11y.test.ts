/**
 * Shared docs chrome (apps/docs/app/layout.tsx).
 *
 * The navbar GitHub control is an icon, so its accessible name has to sit on
 * the anchor (axe link-name). Search is one <Search> mounted in the desktop
 * navbar and again in the mobile sidebar; both inputs need a label (axe label).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Anchor, Search } from 'nextra/components'
import { GitHubIcon } from 'nextra/icons'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
}))

const layout = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/layout.tsx'), 'utf8')

describe('docs layout accessible names', () => {
  it('names the navbar GitHub link on the anchor', () => {
    expect(layout).not.toMatch(/projectLink\s*=/)
    const anchorAt = layout.indexOf('<Anchor')
    const iconAt = layout.indexOf('<GitHubIcon')
    const chromeAt = layout.indexOf('<NavbarAuthChrome')
    expect(anchorAt).toBeGreaterThan(-1)
    expect(iconAt).toBeGreaterThan(anchorAt)
    expect(chromeAt).toBeGreaterThan(iconAt)
    const link = layout.slice(anchorAt, iconAt)
    expect(link).toContain('href="https://github.com/kensaurus/mushi-mushi"')
    expect(link).toContain('aria-label="GitHub repository"')
    expect(layout.slice(iconAt, chromeAt)).toContain('aria-hidden="true"')
  })

  it("puts the mark (Kenji + Mushi-chan under his magnifier) in the navbar logo, decorative, inside Nextra's home link (owner, 2026-11-14)", () => {
    const logoAt = layout.indexOf('logo={')
    const logo = layout.slice(logoAt, layout.indexOf('</span>\n    }', logoAt))
    expect(layout).toContain("import brandMark from '../assets/brand/kenji-mark.webp'")
    expect(logo).toContain('src={brandMark.src}')
    expect(logo).toContain('alt=""')
    expect(logo).toContain('aria-hidden="true"')
    expect(logo).toContain('Mushi Mushi ')
    // Nextra links the logo to "/" (the landing under any basePath) unless
    // logoLink overrides it; an absolute URL here would send local dev to prod.
    expect(layout).not.toMatch(/logoLink\s*=/)
  })

  it('gives the shared search field a programmatic label', () => {
    expect(layout).toContain('search={<Search aria-label="Search docs" />}')
  })

  it('renders the GitHub name on the anchor and the search label on the input', () => {
    const linkHtml = renderToStaticMarkup(
      createElement(
        Anchor,
        { href: 'https://github.com/kensaurus/mushi-mushi', 'aria-label': 'GitHub repository' },
        createElement(GitHubIcon, { height: '24', 'aria-hidden': 'true' }),
      ),
    )
    expect(linkHtml.startsWith('<a ')).toBe(true)
    expect(linkHtml.slice(0, linkHtml.indexOf('>'))).toContain('aria-label="GitHub repository"')
    expect(linkHtml).toContain('aria-hidden="true"')

    const searchHtml = renderToStaticMarkup(createElement(Search, { 'aria-label': 'Search docs' }))
    const input = searchHtml.match(/<input\b[^>]*>/)?.[0] ?? ''
    expect(input).toContain('type="search"')
    expect(input).toContain('aria-label="Search docs"')
    expect(input).toContain('placeholder="Search documentation…"')
  })
})
