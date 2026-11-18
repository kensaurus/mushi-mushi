/**
 * @vitest-environment jsdom
 *
 * The saved fix-branch pattern error sat halfway down General. It now leads
 * with the key problems in the top banner (fresh-eyes 2026-11-18).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStatusBanner } from './SettingsStatusBanner'
import { savedFixBranchInvalid } from './fixBranchField'
import { EMPTY_SETTINGS_STATS } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('savedFixBranchInvalid', () => {
  it('flags the old stored pattern, never the empty default', () => {
    expect(savedFixBranchInvalid('mushi/fix/{date}-{category}-{shortId}')).toBe(true)
    expect(savedFixBranchInvalid('')).toBe(false)
    expect(savedFixBranchInvalid(null)).toBe(false)
    expect(savedFixBranchInvalid('bugfix/MUSHI-{reportId}-{category}')).toBe(false)
  })
})

describe('SettingsStatusBanner branch pattern', () => {
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

  const render = (props: Partial<Parameters<typeof SettingsStatusBanner>[0]>) =>
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(SettingsStatusBanner, { stats: { ...EMPTY_SETTINGS_STATS, sdkConfigEnabled: true }, hasAnthropicKey: true, ...props }),
        ),
      )
    })

  it('sits next to the key problem in the same banner', () => {
    const onFixBranch = vi.fn()
    render({
      keySummary: { attention: 1, expiring: 0, checking: 0, working: 0, replaced: 0, off: 0, total: 1 },
      branchPatternInvalid: true,
      onFixBranch,
    })
    expect(host.textContent).toContain('1 key needs your attention')
    expect(host.querySelector('[data-testid="settings-banner-branch"]')?.textContent).toContain('fix branch pattern is no longer allowed')
    act(() => (host.querySelector('[data-testid="settings-banner-fix-branch"]') as HTMLButtonElement).click())
    expect(onFixBranch).toHaveBeenCalled()
  })

  it('rides under "The bug widget is off", which still leads', () => {
    render({ stats: { ...EMPTY_SETTINGS_STATS, sdkConfigEnabled: false }, branchPatternInvalid: true, onFixBranch: () => {} })
    expect(host.textContent).toContain('The bug widget is off')
    expect(host.querySelector('[data-testid="settings-banner-branch"]')).not.toBeNull()
  })

  it('leads the banner when nothing bigger is wrong', () => {
    render({ branchPatternInvalid: true, onFixBranch: () => {} })
    expect(host.textContent).toContain('Fix branch pattern no longer allowed')
  })
})
