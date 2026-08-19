/**
 * FILE: activeProject.test.ts
 * PURPOSE: Regression tests for the report-detail refresh loop
 *          (the Slack "Triage" link bug).
 *
 *          The loop needed two ingredients:
 *            1. `setActiveProjectIdSnapshot` fired its CustomEvent even when
 *               the value was unchanged — so two writers disagreeing about
 *               the active project re-triggered every usePageData hook on
 *               every write, forever.
 *            2. ReportDetailPage wrote only to storage while
 *               `useActiveProjectId()` reads URL-first — so the disagreement
 *               could never converge.
 *          These tests pin ingredient 1 (the store contract). The URL-
 *          authoritative rewrite is pinned by the comment trail in
 *          ReportDetailPage.tsx / ProjectSwitcher.tsx.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ACTIVE_PROJECT_EVENT,
  getActiveProjectIdSnapshot,
  setActiveProjectIdSnapshot,
} from './activeProject'

const PROJECT_A = '450e6ba8-cf2b-4841-bb38-08141e1ebe77'
const PROJECT_B = '542b34e0-019e-41fe-b900-7b637717bb86'

describe('setActiveProjectIdSnapshot', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('fires the change event on a real change', () => {
    const listener = vi.fn()
    window.addEventListener(ACTIVE_PROJECT_EVENT, listener)
    setActiveProjectIdSnapshot(PROJECT_A)
    expect(getActiveProjectIdSnapshot()).toBe(PROJECT_A)
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(ACTIVE_PROJECT_EVENT, listener)
  })

  it('is idempotent: a redundant write fires no event (refresh-loop guard)', () => {
    setActiveProjectIdSnapshot(PROJECT_A)
    const listener = vi.fn()
    window.addEventListener(ACTIVE_PROJECT_EVENT, listener)
    // Two writers repeatedly asserting the same value (ReportDetailPage +
    // ProjectSwitcher) must not generate events — each event cache-busts
    // every usePageData hook and re-renders the whole console.
    setActiveProjectIdSnapshot(PROJECT_A)
    setActiveProjectIdSnapshot(PROJECT_A)
    setActiveProjectIdSnapshot(PROJECT_A)
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(ACTIVE_PROJECT_EVENT, listener)
  })

  it('two alternating writers settle after each write, not per assertion', () => {
    const listener = vi.fn()
    window.addEventListener(ACTIVE_PROJECT_EVENT, listener)
    setActiveProjectIdSnapshot(PROJECT_A)
    setActiveProjectIdSnapshot(PROJECT_B)
    // Writer 2 re-asserts B (as ProjectSwitcher does after hydrate) — silent.
    setActiveProjectIdSnapshot(PROJECT_B)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(getActiveProjectIdSnapshot()).toBe(PROJECT_B)
    window.removeEventListener(ACTIVE_PROJECT_EVENT, listener)
  })
})
