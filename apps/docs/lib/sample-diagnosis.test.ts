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
import { lovableFixPrompt } from './sample-lovable-prompt'

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

  it('offers Lovable and Bolt the same prompt, minus tests and the pull request', () => {
    const lovable = lovableFixPrompt(prompts.fixPrompt)
    // The pinned prompt is the console builder's output and is not edited.
    expect(prompts.fixPrompt).toContain('open a pull request')
    expect(prompts.fixPrompt).toContain('- A test covers it')
    expect(lovable).not.toMatch(/pull request|\btests?\b|test suite/i)
    // The diagnosis itself is all there: every line of the variant but its closing comes from the pinned prompt.
    const pinned = new Set(prompts.fixPrompt.split('\n'))
    const added = lovable.split('\n').filter((line) => line && !pinned.has(line))
    expect(added).toEqual([
      'In src/components/CheckoutForm.tsx, remove "hidden" from the postcode input so it shows at every width, and replace the silent return in handlePay with a visible error next to the field.',
      '- Nothing else in `CheckoutForm` changes behaviour.',
      'Tell me in plain words what you changed, so I can check it in the preview before I publish.',
    ])
    for (const kept of ['## What is wrong', '## Why it broke', '## Suggested fix', '## How to reproduce', '## Relevant code', '## Done when', report.stage2_analysis.title, report.affected.file]) {
      expect(lovable).toContain(kept)
    }
    expect(lovable).toContain('If you are not confident the diagnosis is right')
    const actions = read(DOCS, 'components', 'demo', 'SampleFixActions.tsx')
    expect(actions).toContain('lovableFixPrompt(fixPrompt)')
    // Lovable or Bolt is the first button; the full prompt stays one click away.
    expect(actions.indexOf('Paste into Lovable or Bolt')).toBeGreaterThan(-1)
    expect(actions.indexOf("'Paste into Lovable or Bolt'")).toBeLessThan(actions.indexOf("'Copy fix prompt'"))
    const page = read(DOCS, 'content', 'demo', 'diagnosis.mdx')
    expect(page).not.toMatch(/install in three steps/)
    expect(page.indexOf('**Lovable or Bolt:**')).toBeLessThan(page.indexOf('**Claude Code or Cursor:**'))
  })

  it('opens Cursor with the same deeplink the console report page uses', () => {
    const DEEPLINK = 'cursor://anysphere.cursor-deeplink/prompt?prompt=${encodeURIComponent(prompt)}'
    expect(read(REPO, 'apps', 'admin', 'src', 'components', 'report-detail', 'FixWithAgentPanel.tsx')).toContain(DEEPLINK)
    expect(read(DOCS, 'components', 'demo', 'SampleFixActions.tsx')).toContain(DEEPLINK)
  })
})
