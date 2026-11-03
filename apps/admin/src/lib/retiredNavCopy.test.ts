/**
 * FILE: apps/admin/src/lib/retiredNavCopy.test.ts
 * PURPOSE: Report c0dc93ec. Console copy must name pages the way the nav
 *          does now: App blueprint, User stories, and Settings → AI keys.
 *          A hand-written "Recipe page", "Inventory page" or
 *          "Settings → API Keys" in the copy the console shows fails here.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_REGISTRY } from './navRegistry'
import { SETTINGS_TAB_LABELS } from './settingsTabExplainer'
import { statDestinationLabel } from './statCardLinks'

const repoRoot = resolve(__dirname, '../../../..')

/** Drop comments so a file header can keep a historical name. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path, out)
      continue
    }
    if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
  }
}

const RETIRED = ['Recipe page', 'Inventory page', 'Settings → API Keys'] as const

/**
 * Langfuse's own project settings are still called API Keys. That sentence
 * is not a Mushi page.
 */
const ALLOW_THIRD_PARTY_API_KEYS = new Set(['apps/admin/src/components/integrations/types.ts'])

describe('retired navigation copy', () => {
  it('names the renamed pages from the nav registry and the Settings tab', () => {
    expect(NAV_REGISTRY.find((e) => e.path === '/recipe')?.label).toBe('App blueprint')
    expect(NAV_REGISTRY.find((e) => e.path === '/inventory')?.label).toBe('User stories')
    expect(SETTINGS_TAB_LABELS.byok).toBe('AI keys')
    expect(statDestinationLabel('/recipe')).toBe('App blueprint')
    expect(statDestinationLabel('/inventory')).toBe('User stories')
    expect(statDestinationLabel('/settings?tab=byok')).toBe('Settings · AI keys')
  })

  it('does not use a retired page name in console copy or the server text the console shows', () => {
    const files: string[] = []
    walk(resolve(repoRoot, 'apps/admin/src'), files)
    walk(resolve(repoRoot, 'packages/server/supabase/functions'), files)
    const hits: string[] = []
    for (const file of files) {
      const rel = relative(repoRoot, file)
      const text = stripComments(readFileSync(file, 'utf8'))
      for (const phrase of RETIRED) {
        if (phrase === 'Settings → API Keys' && ALLOW_THIRD_PARTY_API_KEYS.has(rel)) continue
        if (text.includes(phrase)) hits.push(`${rel}: ${phrase}`)
      }
    }
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('links the App blueprint to its Risk checks section and takes the routes label from the route catalog', () => {
    const compose = readFileSync(resolve(repoRoot, 'packages/server/supabase/functions/api/routes/recipe-compose.ts'), 'utf8')
    expect(compose).toContain("consolePageLabel('/inventory')")
    expect(compose).toContain("{ label: 'Risk checks', to: '/recipe#risk-checks' }")
    const radar = readFileSync(resolve(repoRoot, 'apps/admin/src/components/portfolio/RadarPanel.tsx'), 'utf8')
    expect(radar).toContain('id="risk-checks"')
    const holes = readFileSync(resolve(repoRoot, 'apps/admin/src/components/code-health/KnownHolesCard.tsx'), 'utf8')
    expect(holes).toContain('to="/recipe#risk-checks"')
  })
})
