/**
 * FILE: sdkLockfileHelper.test.ts
 * PURPOSE: The console copy block and the docs template are one workflow
 *          (ADR 0019). A drift between them hands hosts two different files.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SDK_LOCKFILE_DOCS_URL, SDK_LOCKFILE_WORKFLOW_PATH, SDK_LOCKFILE_WORKFLOW_YAML } from './sdkLockfileHelper'

const ROOT = resolve(__dirname, '../../../..')

describe('SDK lockfile helper template', () => {
  it('equals docs/templates/mushi-sdk-lockfile.yml byte for byte', () => {
    const template = readFileSync(resolve(ROOT, 'docs/templates/mushi-sdk-lockfile.yml'), 'utf8').replace(/\r\n/g, '\n')
    expect(SDK_LOCKFILE_WORKFLOW_YAML).toBe(template)
  })

  it('is the YAML shown on the public docs page', () => {
    const mdx = readFileSync(resolve(ROOT, 'apps/docs/content/admin/sdk-upgrade-lockfile.mdx'), 'utf8').replace(/\r\n/g, '\n')
    const block = mdx.match(/```yaml\n([\s\S]*?)```/)?.[1]
    expect(block).toBe(SDK_LOCKFILE_WORKFLOW_YAML)
  })

  it('keeps the loop guard, the branch filter and the cost limits', () => {
    expect(SDK_LOCKFILE_WORKFLOW_YAML).toContain("branches: ['mushi/sdk-upgrade-**']")
    expect(SDK_LOCKFILE_WORKFLOW_YAML).toContain("if: github.actor != 'github-actions[bot]'")
    expect(SDK_LOCKFILE_WORKFLOW_YAML).toContain('timeout-minutes: 10')
    expect(SDK_LOCKFILE_WORKFLOW_YAML).toContain('cancel-in-progress: true')
    expect(SDK_LOCKFILE_WORKFLOW_YAML).toContain('fetch-depth: 2')
  })

  it('matches the path and docs URL the server uses', () => {
    const server = readFileSync(
      resolve(ROOT, 'packages/server/supabase/functions/_shared/sdk-upgrade-pr.ts'),
      'utf8',
    )
    expect(server).toContain(`'${SDK_LOCKFILE_WORKFLOW_PATH}'`)
    expect(server).toContain(`'${SDK_LOCKFILE_DOCS_URL}'`)
  })
})
