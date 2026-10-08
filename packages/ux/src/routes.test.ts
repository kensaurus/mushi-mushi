// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nextRoutePath, reactRouterPaths, screenFiles } from './routes.js'

describe('reactRouterPaths', () => {
  it('reads absolute static paths from JSX props and route objects, skipping params and wildcards', () => {
    const src = `
      <Route path="/login" element={<LoginPage />} />
      <Route path={'/settings'} element={<Settings />} />
      <Route path="apps" element={<Apps />} />
      <Route path="/reports/:id" element={<Report />} />
      <Route path="/*" element={<Shell />} />
      const routes = [{ path: '/billing', element: <Billing /> }, { path: '/docs/[slug]' }]`
    expect(reactRouterPaths(src)).toEqual(['/login', '/settings', '/billing'])
  })

  it('reads a long run of whitespace with no quote after it in linear time (CodeQL js/polynomial-redos)', () => {
    const src = 'path=' + '\t'.repeat(100_000) + 'x <Route path = {  "/ok" } />'
    const started = performance.now()
    expect(reactRouterPaths(src)).toEqual(['/ok'])
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('nextRoutePath', () => {
  it.each([
    ['app/page.tsx', '/'],
    ['src/app/(marketing)/pricing/page.tsx', '/pricing'],
    ['app/dashboard/settings/page.jsx', '/dashboard/settings'],
    ['app/blog/[slug]/page.tsx', null],
    ['app/dashboard/layout.tsx', null],
    ['pages/index.tsx', '/'],
    ['pages/about.tsx', '/about'],
    ['pages/_app.tsx', null],
    ['pages/api/health.ts', null],
  ])('%s → %s', (file, path) => expect(nextRoutePath(file)).toBe(path))
})

describe('screenFiles', () => {
  it('names the page, its layout and the components beside it (glot.it /practice shape)', () => {
    const root = mkdtempSync(join(tmpdir(), 'mushi-ux-screen-'))
    try {
      const put = (rel: string) => {
        mkdirSync(join(root, ...rel.split('/').slice(0, -1)), { recursive: true })
        writeFileSync(join(root, ...rel.split('/')), 'export {}')
      }
      ;['app/page.tsx', 'app/layout.tsx', 'app/(learn)/practice/page.tsx', 'app/(learn)/practice/layout.tsx', 'app/(learn)/practice/error.tsx',
        'app/(learn)/practice/_components/hub.tsx', 'app/(learn)/practice/_components/hub.test.tsx', 'node_modules/x/app/practice/page.tsx'].forEach(put)
      expect(screenFiles(root, '/practice/')).toEqual([
        'app/(learn)/practice/page.tsx',
        'app/(learn)/practice/layout.tsx',
        'app/(learn)/practice/_components/hub.tsx',
      ])
      expect(screenFiles(root, '/')).toEqual(['app/page.tsx', 'app/layout.tsx'])
      expect(screenFiles(root, '/nowhere')).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
