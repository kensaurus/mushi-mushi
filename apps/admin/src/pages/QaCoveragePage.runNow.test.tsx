/**
 * FILE: QaCoveragePage.runNow.test.tsx
 * PURPOSE: Run now stays disabled for a local Playwright story, on the
 *          card and in the story drawer. The edge manual trigger would
 *          only record a skipped row.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  story: null as null | {
    id: string
    project_id: string
    name: string
    prompt: null
    script: null
    script_lang: string
    browser_provider: string
    schedule_cron: string
    enabled: boolean
    byok_provider: null
    target_url: null
    created_at: string
    updated_at: string
  },
}))

const reload = vi.hoisted(() => () => {})

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { loading: false, error: null, reload, isValidating: false, lastFetchedAt: null }
    if (String(path).includes('/runs')) return { ...base, data: { runs: [] } }
    if (String(path).includes('entitlements')) return { ...base, data: null }
    return { ...base, data: state.story }
  },
}))

vi.mock('../lib/toast', () => ({
  useToast: () => ({ success: () => {}, error: () => {}, push: () => {} }),
}))

vi.mock('../components/ProjectSwitcher', () => ({
  useActiveProjectId: () => 'p1',
  ProjectSwitcher: () => null,
}))

vi.mock('../components/ProjectFavicon', () => ({ ProjectFavicon: () => null }))

import { StoryCard, StoryDrawer } from './QaCoveragePage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function coverage(provider: string) {
  return {
    story_id: 's1',
    project_id: 'p1',
    name: 'Checkout',
    enabled: true,
    browser_provider: provider,
    last_run_status: null,
    runs_24h: 0,
    passed_24h: 0,
    failed_24h: 0,
    error_24h: 0,
    pass_rate_pct: null,
    last_run_at: null,
    last_failure_url: null,
  }
}

function story(provider: string) {
  return {
    id: 's1',
    project_id: 'p1',
    name: 'Checkout',
    prompt: null,
    script: null,
    script_lang: 'playwright-ts',
    browser_provider: provider,
    schedule_cron: '0 * * * *',
    enabled: true,
    byok_provider: null,
    target_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

let container: HTMLDivElement
let root: Root

function render(node: ReturnType<typeof createElement>) {
  act(() => { root.render(node) })
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === label)
  if (!found) throw new Error(`no button ${label}`)
  return found as HTMLButtonElement
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find((el) => el.textContent?.includes(text))
  if (!found) throw new Error(`no button ${text}`)
  return found as HTMLButtonElement
}

beforeEach(() => {
  state.story = story('local')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

describe('Run now for local stories', () => {
  it('disables the card button and does not start a run', () => {
    const onRunNow = vi.fn()
    render(createElement(StoryCard, {
      coverage: coverage('local'),
      isQueued: false,
      onRunNow,
      onSelect: () => {},
      highlighted: false,
    }))
    const button = buttonByLabel('Run Checkout now')
    expect(button.disabled).toBe(true)
    button.click()
    expect(onRunNow).not.toHaveBeenCalled()
  })

  it('leaves the card button enabled for a cloud story', () => {
    const onRunNow = vi.fn()
    render(createElement(StoryCard, {
      coverage: coverage('firecrawl_actions'),
      isQueued: false,
      onRunNow,
      onSelect: () => {},
      highlighted: false,
    }))
    const button = buttonByLabel('Run Checkout now')
    expect(button.disabled).toBe(false)
    button.click()
    expect(onRunNow).toHaveBeenCalledWith('s1')
  })

  it('disables Run now in the drawer for a local story', () => {
    state.story = story('local')
    const onRunNow = vi.fn()
    render(createElement(StoryDrawer, {
      storyId: 's1',
      projectId: 'p1',
      onClose: () => {},
      onRunNow,
      isQueued: false,
      onStoryChanged: () => {},
    }))
    const button = buttonByText('Run now')
    expect(button.disabled).toBe(true)
    button.click()
    expect(onRunNow).not.toHaveBeenCalled()
  })

  it('leaves Run now enabled in the drawer for a cloud story', () => {
    state.story = story('firecrawl_actions')
    const onRunNow = vi.fn()
    render(createElement(StoryDrawer, {
      storyId: 's1',
      projectId: 'p1',
      onClose: () => {},
      onRunNow,
      isQueued: false,
      onStoryChanged: () => {},
    }))
    const button = buttonByText('Run now')
    expect(button.disabled).toBe(false)
  })
})
