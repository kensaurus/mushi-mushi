/**
 * FILE: console-deeplink-contract.test.ts
 * PURPOSE: Stats routes hand the console a `topPriorityTo` link. Each one
 *          here used to land on the page the user was already on with
 *          nothing to act on. Source-level guard: the server link names a
 *          target that the console page actually renders and reads.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const API = resolve(__dirname, '../../supabase/functions/api/routes')
const ADMIN = resolve(__dirname, '../../../../apps/admin/src')
const read = (p: string) => readFileSync(p, 'utf8')

describe('stats deep links land on something', () => {
  it('Code Health "Review oversized files" scrolls to the god-file list', () => {
    expect(read(resolve(API, 'code-health.ts'))).toContain('#god-files')
    const page = read(resolve(ADMIN, 'pages/CodeHealthPage.tsx'))
    expect(page).toContain('id="god-files"')
    expect(page).toContain("location.hash !== '#god-files'")
  })

  it('Code Health empty state does not nest a button inside a link', () => {
    const page = read(resolve(ADMIN, 'pages/CodeHealthPage.tsx'))
    expect(page).not.toMatch(/<Link[^>]*>\s*<Btn/)
  })

  it('Research "Attach evidence" opens the session holding the snippets', () => {
    expect(read(resolve(API, 'settings-research.ts'))).toContain('/research?tab=search&session=')
    expect(read(resolve(ADMIN, 'pages/ResearchPage.tsx'))).toContain("searchParams.get('session')")
  })

  it('Prompt Lab banner links open a stage table the page reads', () => {
    expect(read(resolve(API, 'prompt-lab.ts'))).toContain('/prompt-lab?tab=prompts&stage=')
    const page = read(resolve(ADMIN, 'pages/PromptLabPage.tsx'))
    expect(page).toContain("searchParams.get('stage')")
    expect(page).toContain('id="prompt-lab-stages"')
  })
})
