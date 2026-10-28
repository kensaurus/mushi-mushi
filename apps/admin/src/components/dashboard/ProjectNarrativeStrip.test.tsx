/**
 * @vitest-environment jsdom
 */

/**
 * Set up's "Your loop" cards spoke in internals: "Plan → Do → Check → Act",
 * "Stage 1 (Haiku) → Stage 2 (Sonnet + vision)", "dispatches the auto-fix
 * agent", "a judge model", "Open Judge", and claimed new reports "now
 * resolve automatically" (console sweep, 2026-10-28).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectNarrativeStrip } from './ProjectNarrativeStrip'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(flags: { sdkInstalled: boolean; hasReports: boolean; hasFix: boolean; hasMerged: boolean }) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(ProjectNarrativeStrip, { projectName: 'mushi-mushi', ...flags })))
  })
  return container.textContent ?? ''
}

const JARGON = /PDCA|Plan → Do|Haiku|Sonnet|dispatch|judge|Langfuse|LLM|resolve automatically|\bPR\b/i

describe('ProjectNarrativeStrip', () => {
  it('explains a finished loop in plain words', async () => {
    const text = await render({ sdkInstalled: true, hasReports: true, hasFix: true, hasMerged: true })
    expect(text).toContain('has fixed a bug end to end')
    expect(text).toContain('Open Triage grading')
    expect(text).not.toMatch(JARGON)
  })

  it('explains the first steps in plain words', async () => {
    const text = await render({ sdkInstalled: false, hasReports: false, hasFix: false, hasMerged: false })
    expect(text).toContain('Step 1')
    expect(text).not.toMatch(JARGON)
  })
})
