/**
 * FILE: apps/admin/src/lib/publicIntegrations.test.ts
 * PURPOSE: QA #70. Every "Docs" link on the public integrations page pointed
 *          at /docs/integrations/<name>, which does not exist. Each tile must
 *          now point at a docs page that is really in apps/docs/content.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INTEGRATIONS,
  PLUGIN_SDK_DOCS_URL,
  PLUGIN_SDK_REPO_URL,
  PUBLIC_DOCS_BASE,
  integrationDocsHref,
} from './publicIntegrations'

const DOCS_CONTENT = join(__dirname, '..', '..', '..', 'docs', 'content')
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')

function docsFileFor(url: string): string {
  expect(url.startsWith(`${PUBLIC_DOCS_BASE}/`)).toBe(true)
  return join(DOCS_CONTENT, `${url.slice(PUBLIC_DOCS_BASE.length + 1)}.mdx`)
}

describe('public integrations docs links', () => {
  it('points every tile at a docs page that exists', () => {
    const missing = INTEGRATIONS.map((i) => ({ name: i.name, file: docsFileFor(integrationDocsHref(i)) }))
      .filter(({ file }) => !existsSync(file))
      .map(({ name, file }) => `${name} -> ${file}`)
    expect(missing).toEqual([])
  })

  it('links the plugin SDK docs page and its source on the default branch', () => {
    expect(existsSync(docsFileFor(PLUGIN_SDK_DOCS_URL))).toBe(true)
    expect(PLUGIN_SDK_REPO_URL).toContain('/tree/master/packages/plugin-sdk')
    expect(existsSync(join(REPO_ROOT, 'packages', 'plugin-sdk'))).toBe(true)
  })
})
