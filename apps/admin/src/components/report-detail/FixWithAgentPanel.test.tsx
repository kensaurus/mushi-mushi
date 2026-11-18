/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/FixWithAgentPanel.test.tsx
 * PURPOSE: REPORT B15 (2026-10-04). The report page's only fix hand-off was a
 *          Cursor-only card whose "Copy prompt" held MCP tool calls, not the
 *          bug. The primary action must copy a self-contained prompt.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportDetail } from './types'

const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))
vi.mock('../../lib/track', () => ({ trackSelf: vi.fn() }))
vi.mock('../ClientConnectButton', () => ({ ClientConnectButton: () => createElement('span', null, 'connect-claude') }))
vi.mock('../explore/CopyRepoDigestButton', () => ({ CopyRepoDigestButton: () => null }))
vi.mock('../ui', () => ({
  Card: ({ children, className }: { children: unknown; className?: string }) =>
    createElement('div', { className }, children as never),
  Btn: ({ children, to: _to, leadingIcon: _icon, ...rest }: Record<string, unknown>) =>
    createElement('button', rest, children as never),
}))

import { FixWithAgentPanel } from './FixWithAgentPanel'

let container: HTMLDivElement
let root: Root
const writeText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  writeText.mockClear()
  window.localStorage.clear()
  toast.success.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const REPORT = {
  id: 'c0e99783-a48f-43bf-9fd9-84708dec1a3c',
  project_id: 'p1',
  project_name: 'glot.it',
  description: 'Lesson says 5 minutes but takes 20',
  title: 'Lesson length is wrong on the home page',
  summary: 'FeaturedLessonCard shows a stale duration.',
  severity: 'medium',
  category: 'confusing',
  component: 'FeaturedLessonCard',
  confidence: 0.82,
  status: 'classified',
  environment: { url: 'https://glot.it/home', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/147.0.0.0' },
  console_logs: null,
  network_logs: null,
  stage1_classification: { category: 'confusing' },
  stage2_analysis: { rootCause: 'The minutes prop is out of sync.', suggestedFix: 'Read lesson.estimatedMinutes.' },
  created_at: '2026-10-04T00:00:00Z',
} as unknown as ReportDetail

const button = (name: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === name)

describe('FixWithAgentPanel', () => {
  // Sweep 2026-11-18: a red "Copy fix prompt" argued with "a fix agent usually can't act on it".
  it('leads with Copy fix prompt only when the report names code to change', () => {
    act(() => root.render(createElement(FixWithAgentPanel, { report: REPORT })))
    expect(container.querySelector('[data-testid="copy-fix-prompt"]')?.getAttribute('variant')).toBe('ghost')
    act(() => root.render(createElement(FixWithAgentPanel, { report: { ...REPORT, component: 'src/home/FeaturedLessonCard.tsx' } as ReportDetail })))
    expect(container.querySelector('[data-testid="copy-fix-prompt"]')?.getAttribute('variant')).toBe('primary')
  })

  it('is named for any agent, not Cursor only', () => {
    act(() => root.render(createElement(FixWithAgentPanel, { report: REPORT })))
    expect(container.querySelector('h2')?.textContent).toBe('Fix it with your coding agent')
    expect(container.textContent).not.toContain('.cursor/mcp.json')
  })

  it('"Copy fix prompt" copies the bug itself, not MCP tool calls', async () => {
    act(() => root.render(createElement(FixWithAgentPanel, { report: REPORT })))
    await act(async () => {
      button('Copy fix prompt')!.click()
    })
    const copied = writeText.mock.calls[0]?.[0] as string
    expect(copied).toContain('Lesson length is wrong on the home page')
    expect(copied).toContain('The minutes prop is out of sync.')
    expect(copied).toContain('Read lesson.estimatedMinutes.')
    expect(copied).toContain('Fixes Mushi report c0e99783-a48f-43bf-9fd9-84708dec1a3c')
    expect(copied).not.toContain('get_fix_context')
  })

  it('keeps Claude Code, Cursor and MCP as secondary lanes', async () => {
    act(() => root.render(createElement(FixWithAgentPanel, { report: REPORT })))
    for (const name of ['Use with Claude Code', 'Use with Cursor', 'Use MCP']) {
      expect(button(name)?.getAttribute('aria-expanded')).toBe('false')
    }
    act(() => button('Use with Claude Code')!.click())
    expect(button('Use with Claude Code')?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('connect-claude')

    act(() => button('Use MCP')!.click())
    await act(async () => {
      button('Copy MCP prompt')!.click()
    })
    expect(writeText.mock.calls.at(-1)?.[0]).toContain('get_fix_context')

    act(() => button('Use with Cursor')!.click())
    expect(button('Open in Cursor')).toBeTruthy()
    expect(button('Cursor cloud agent')).toBeTruthy()
  })

  // Owner's walkthrough, 2026-11-17.
  it('folds the explanation away and keeps Copy fix prompt in view', () => {
    act(() => root.render(createElement(FixWithAgentPanel, { report: REPORT })))
    const explainer = container.querySelector('[data-testid="fix-agent-explainer"]') as HTMLDetailsElement
    expect(explainer.open).toBe(false)
    expect(button('Copy fix prompt')).toBeTruthy()
  })

  it('opens the hand-off picked last, and says "Sent to Cursor" after opening it', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    act(() => root.render(createElement(FixWithAgentPanel, { report: REPORT })))
    act(() => button('Use with Cursor')!.click())
    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(createElement(FixWithAgentPanel, { report: REPORT })))
    expect(button('Use with Cursor')?.getAttribute('aria-expanded')).toBe('true')
    act(() => button('Open in Cursor')!.click())
    expect(open).toHaveBeenCalled()
    expect(container.querySelector('[data-testid="fix-sent-to"]')!.textContent).toContain('Sent to Cursor.')
    expect(toast.success).toHaveBeenCalledWith('Sent to Cursor', expect.any(String))
    open.mockRestore()
  })
})
