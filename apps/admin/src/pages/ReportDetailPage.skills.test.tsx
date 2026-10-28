/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/ReportDetailPage.skills.test.tsx
 * PURPOSE: Recommended-skill rows on the report detail page each show and
 *          copy their own project-scoped triage URL.
 *
 * OVERVIEW:
 * - Renders RecommendedSkillsSection with two skills
 * - Checks the truncated URL preview, the small copy button, and the
 *   clipboard value (?project= plus that skill's slug)
 *
 * DEPENDENCIES:
 * - react-dom/client, react-router-dom MemoryRouter, vitest
 *
 * USAGE:
 * - `pnpm --filter @mushi-mushi/admin exec vitest run src/pages/ReportDetailPage.skills.test.tsx`
 *
 * NOTES:
 * - The copy button's value is not in the DOM; the test reads it from
 *   navigator.clipboard.writeText after a click.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportDetail } from '../components/report-detail/types'
import { skillTriagePermalink } from '../lib/reportUrl'

// The page module pulls workspace packages that are not built in this
// worktree. These stubs keep the skills section renderable.
vi.mock('../lib/track', () => ({ trackSelf: vi.fn() }))
vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }))
vi.mock('../lib/dispatchFix', () => ({ useDispatchFix: () => ({ state: {}, dispatch: vi.fn() }) }))
vi.mock('../lib/usePlatformIntegrations', () => ({ usePlatformIntegrations: () => ({ traceUrl: () => null }) }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => null }))
vi.mock('../components/SdkUpgradeCTA', () => ({ SdkUpgradeCTA: () => null }))
vi.mock('../components/report-detail/ReporterViewPanel', () => ({ ReporterViewPanel: () => null }))
vi.mock('../components/report-detail/DiagnosisFixHero', () => ({ DiagnosisFixHero: () => null }))

import { RecommendedSkillsSection } from './ReportDetailPage'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const REPORT = 'c0e99783-a48f-43bf-9fd9-84708dec1a3c'
const SKILLS = [
  { slug: 'enhance-web-ux', title: 'Page UX', rationale: 'Heuristics on the report page' },
  { slug: 'audit-a11y', title: 'Accessibility', rationale: 'Contrast on the same page' },
] as const

const writeText = vi.hoisted(() => vi.fn(async (_value: string) => {}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderSkills(): void {
  const report = {
    id: REPORT,
    project_id: PROJECT,
    recommended_skills: SKILLS.map((skill) => ({ ...skill })),
  } as ReportDetail
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(RecommendedSkillsSection, { report }),
      ),
    )
  })
}

function copyButtons(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((button): button is HTMLButtonElement =>
    (button.getAttribute('aria-label') ?? '').startsWith('Copy triage link'),
  )
}

describe('RecommendedSkillsSection triage links', () => {
  it('shows a truncated triage URL for each skill, with the full URL on hover', () => {
    renderSkills()
    for (const skill of SKILLS) {
      const expected = skillTriagePermalink(REPORT, PROJECT, skill.slug)
      const preview = container.querySelector(`[data-testid="skill-triage-url-${skill.slug}"]`)
      expect(preview).not.toBeNull()
      const text = preview?.textContent ?? ''
      expect(text).toContain('?project=')
      expect(text).toContain(skill.slug)
      expect(text.length).toBeLessThan(expected.length)
      expect(text.startsWith('…')).toBe(true)
      expect(preview?.getAttribute('title')).toBe(expected)
      const button = copyButtons().find((candidate) =>
        (candidate.getAttribute('aria-label') ?? '').includes(skill.slug),
      )
      expect(button?.getAttribute('aria-label')).toContain(expected)
    }
  })

  it('uses the small copy button beside the text-2xs triage line', () => {
    renderSkills()
    const buttons = copyButtons()
    expect(buttons).toHaveLength(SKILLS.length)
    for (const button of buttons) {
      expect(button.className).toContain('h-5')
      expect(button.className).toContain('w-5')
      expect(button.className).not.toContain('h-7')
    }
  })

  it('copies a project-scoped URL that names that skill', async () => {
    renderSkills()
    const buttons = copyButtons()
    expect(buttons).toHaveLength(SKILLS.length)
    for (const [index, skill] of SKILLS.entries()) {
      writeText.mockClear()
      await act(async () => {
        buttons[index]!.click()
      })
      expect(writeText).toHaveBeenCalledTimes(1)
      const copied = writeText.mock.calls[0]?.[0]
      expect(typeof copied).toBe('string')
      const params = new URL(copied as string).searchParams
      expect(params.get('project')).toBe(PROJECT)
      expect(params.get('skill')).toBe(skill.slug)
      for (const other of SKILLS) {
        if (other.slug !== skill.slug) expect(params.get('skill')).not.toBe(other.slug)
      }
    }
  })
})
