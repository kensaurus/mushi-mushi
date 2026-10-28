/**
 * The public sample diagnosis (/demo/diagnosis) must stay honest and match
 * what the console produces:
 *   - it says "Sample" wherever it renders, and never claims model output;
 *   - its fix prompts are the console builder's output for this sample
 *     (generated and drift-checked by apps/admin/.../fixPrompt.sample.test.ts);
 *   - its "Open in Cursor" link is the console's Cursor deeplink.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import report from '../data/sample-report.json'
import prompts from '../data/sample-fix-prompt.json'

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(DOCS, '..', '..')
const read = (...rel: string[]) => readFileSync(join(...rel), 'utf8')

describe('sample diagnosis page', () => {
  it('is labelled a sample and never presented as a real report or model output', () => {
    expect(report.id).toMatch(/^sample-/)
    const component = read(DOCS, 'components', 'demo', 'SampleDiagnosis.tsx')
    expect(component).toContain('<span>Sample</span>')
    expect(component).toMatch(/A report and diagnosis we wrote/)
    const page = read(DOCS, 'content', 'demo', 'diagnosis.mdx')
    expect(page).toContain('<SampleDiagnosis />')
    expect(page).toMatch(/We wrote the sample above/)
  })

  it('shows the fix prompt the console builds for this report', () => {
    expect(prompts.fixPrompt).toContain(`Mushi report ${report.id}`)
    expect(prompts.fixPrompt).toContain(report.stage2_analysis.title)
    expect(prompts.fixPrompt).toContain(report.affected.file)
    for (const line of report.affected.lines) expect(prompts.fixPrompt).toContain(line.code)
    // The link copy is shorter and carries no code, as in the console.
    expect(prompts.urlFixPrompt.length).toBeLessThan(prompts.fixPrompt.length)
    expect(prompts.urlFixPrompt).not.toContain('## Relevant code')
  })

  it('opens Cursor with the same deeplink the console report page uses', () => {
    const DEEPLINK = 'cursor://anysphere.cursor-deeplink/prompt?prompt=${encodeURIComponent(prompt)}'
    expect(read(REPO, 'apps', 'admin', 'src', 'components', 'report-detail', 'FixWithAgentPanel.tsx')).toContain(DEEPLINK)
    expect(read(DOCS, 'components', 'demo', 'SampleFixActions.tsx')).toContain(DEEPLINK)
  })
})
