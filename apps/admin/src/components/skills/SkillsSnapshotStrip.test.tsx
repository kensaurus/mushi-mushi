/**
 * @vitest-environment jsdom
 *
 * Idle Agent skills: one sentence with the catalog count, no "0 Running ·
 * 0 Waiting" tiles (round-2 review 2026-11-18: the empty state was said 4 ways).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkillsSnapshotStrip } from './SkillsSnapshotStrip'
import { EMPTY_SKILLS_STATS, type SkillsStats } from './SkillsStatsTypes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SkillsSnapshotStrip', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  const render = (stats: Partial<SkillsStats>) =>
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(SkillsSnapshotStrip, {
            stats: { ...EMPTY_SKILLS_STATS, hasAnyProject: true, topPriority: 'healthy', ...stats },
            statsFetchedAt: null,
          }),
        ),
      )
    })

  it('idle: the count in one sentence and no zero tiles', () => {
    render({ catalogTotal: 173 })
    expect(host.textContent).toContain('173 skills to choose from.')
    expect(host.textContent).not.toContain('No skill runs going')
    expect(host.querySelector('dl')).toBeNull()
  })

  it('with a run going: the tiles come back', () => {
    render({ catalogTotal: 173, activeRuns: 1 })
    expect(host.textContent).toContain('1 skill run going')
    expect(host.querySelector('dl')).not.toBeNull()
  })
})
