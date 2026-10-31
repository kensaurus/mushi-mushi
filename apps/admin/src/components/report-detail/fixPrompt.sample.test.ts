/**
 * The public sample diagnosis page (apps/docs/content/demo/diagnosis.mdx)
 * shows the fix prompt "exactly as the product produces it". The docs site
 * cannot import this builder, so the prompts are generated here from the
 * docs' sample report and kept as a file snapshot the docs page imports.
 *
 * A change to buildFixPrompt / buildUrlFixPrompt or to the sample report
 * fails this test; re-run it with `-u` and commit the regenerated
 * apps/docs/data/sample-fix-prompt.json with the change.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildFixPrompt, buildUrlFixPrompt } from './fixPrompt'
import type { ReportDetail } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const DOCS_DATA = join(here, '../../../../docs/data')

const sample = JSON.parse(readFileSync(join(DOCS_DATA, 'sample-report.json'), 'utf8')) as ReportDetail

describe('docs sample diagnosis fix prompt', () => {
  it('is what the console would copy for the sample report', async () => {
    const fixPrompt = buildFixPrompt(sample)
    const urlFixPrompt = buildUrlFixPrompt(sample)
    // The page's copy is meant to be the whole prompt, code included.
    expect(fixPrompt).toContain('src/components/CheckoutForm.tsx')
    expect(fixPrompt).toContain('if (!address.postcode) return')
    await expect(`${JSON.stringify({ fixPrompt, urlFixPrompt }, null, 2)}\n`).toMatchFileSnapshot(
      join(DOCS_DATA, 'sample-fix-prompt.json'),
    )
  })
})
