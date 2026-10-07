/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/inventory/UserStoryMap.test.tsx
 * PURPOSE: The story map no longer repeats "Run crawler" / "Run gates" on
 *          every story card (2026-10-07: a long list showed 10+ identical
 *          crawler buttons). Each story has one actions menu whose items say
 *          what the story-scoped run does; the page-wide run lives once in
 *          the page action row.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserStoryMap, type Story } from './UserStoryMap'

const stories: Story[] = Array.from({ length: 12 }, (_, i) => ({
  id: `story-${i}`,
  label: `Story ${i}`,
  metadata: { title: `Checkout ${i}` },
  actions: [{ id: `a-${i}`, label: `Pay ${i}`, status: 'verified' }],
}))

describe('UserStoryMap story actions', () => {
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

  const buttonsWithText = (text: string) =>
    Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.trim() === text)

  it('shows no per-story "Run crawler" or "Run gates" buttons', async () => {
    await act(async () => {
      root.render(
        createElement(UserStoryMap, { stories, onRunGatesForStory: vi.fn(), onRunCrawlerForStory: vi.fn() }),
      )
    })
    expect(buttonsWithText('Run crawler')).toHaveLength(0)
    expect(buttonsWithText('Run gates')).toHaveLength(0)
    expect(container.querySelectorAll('button[aria-label^="Actions for "]')).toHaveLength(12)
  })

  it('runs the story-scoped crawl and gates from the story menu', async () => {
    const onRunGatesForStory = vi.fn()
    const onRunCrawlerForStory = vi.fn()
    await act(async () => {
      root.render(createElement(UserStoryMap, { stories, onRunGatesForStory, onRunCrawlerForStory }))
    })
    const menu = container.querySelector<HTMLButtonElement>('button[aria-label="Actions for Checkout 3"]')!
    await act(async () => menu.click())
    await act(async () => buttonsWithText("Crawl this story's pages")[0].click())
    expect(onRunCrawlerForStory).toHaveBeenCalledWith('story-3')

    await act(async () => menu.click())
    await act(async () => buttonsWithText('Run gates on this story')[0].click())
    expect(onRunGatesForStory).toHaveBeenCalledWith('story-3')
  })

  it('renders no menu when the page passes no story actions', async () => {
    await act(async () => {
      root.render(createElement(UserStoryMap, { stories }))
    })
    expect(container.querySelectorAll('button[aria-label^="Actions for "]')).toHaveLength(0)
  })
})
