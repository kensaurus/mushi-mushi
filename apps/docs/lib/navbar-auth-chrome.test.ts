/**
 * The docs navbar as the static export ships it (server render, before
 * hydration). A first-time visitor must get a no-account path — the free
 * Production Check — instead of a lone "Console" link that lands on the
 * console's login wall (MUSHI-f2ccc05f).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NavbarAuthChrome } from '../components/NavbarAuthChrome'
import { ADMIN_CONSOLE_URL } from './migrationProgress'

describe('NavbarAuthChrome static markup', () => {
  const html = renderToStaticMarkup(createElement(NavbarAuthChrome))
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])

  it('offers the free check, which needs no account', () => {
    expect(hrefs).toContain('/check')
    expect(html).toContain('Free check')
  })

  it('offers sign-up and sign-in', () => {
    expect(hrefs).toContain(`${ADMIN_CONSOLE_URL}/signup?src=docs-nav`)
    expect(hrefs).toContain(`${ADMIN_CONSOLE_URL}/login`)
  })

  it('does not link to the auth-gated console root', () => {
    expect(hrefs).not.toContain(`${ADMIN_CONSOLE_URL}/`)
    expect(hrefs).not.toContain(`${ADMIN_CONSOLE_URL}/dashboard`)
    expect(html).not.toContain('>Console<')
  })
})
