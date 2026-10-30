/**
 * The docs navbar is a static export. Its first HTML is what a signed-out
 * visitor can click before JS runs. That shell used to be "Console" linking
 * at the admin root, which the console redirects to /login.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NavbarAuthChrome } from '../components/NavbarAuthChrome'
import { ADMIN_CONSOLE_URL } from './migrationProgress'

const ADMIN = ADMIN_CONSOLE_URL

describe('NavbarAuthChrome signed-out shell', () => {
  const html = renderToStaticMarkup(createElement(NavbarAuthChrome))

  it('offers sign-up and sign-in, not a Console link to the gated admin root', () => {
    expect(html).toContain(`href="${ADMIN}/signup?src=docs-nav"`)
    expect(html).toContain('>Start free<')
    expect(html).toContain(`href="${ADMIN}/login"`)
    expect(html).toContain('>Sign in<')
    expect(html).not.toContain('>Console<')
    expect(html).not.toContain(`href="${ADMIN}/"`)
    expect(html).not.toContain(`href="${ADMIN}"`)
  })
})
