/**
 * FILE: apps/admin/src/lib/modeAwareTab.test.ts
 * PURPOSE: Quickstart (the default mode) must not override a tab the user
 *          picked: `+ Draft` on /releases and `?tab=query` on /lessons were
 *          reverted on every render (QA bug 208).
 */

import { describe, expect, it } from 'vitest'
import { resolveModeAwareTab } from './modeAwareTab'

describe('resolveModeAwareTab', () => {
  it('keeps an explicit tab in quickstart', () => {
    expect(resolveModeAwareTab({ explicit: 'draft', isQuickstart: true, quickTab: 'published', fallback: 'overview' })).toBe('draft')
  })

  it('lands on the posture tab in quickstart when the URL names none', () => {
    expect(resolveModeAwareTab({ explicit: null, isQuickstart: true, quickTab: 'drafts', fallback: 'overview' })).toBe('drafts')
  })

  it('uses the fallback while stats load or outside quickstart', () => {
    expect(resolveModeAwareTab({ explicit: null, isQuickstart: true, quickTab: null, fallback: 'overview' })).toBe('overview')
    expect(resolveModeAwareTab({ explicit: null, isQuickstart: false, quickTab: 'drafts', fallback: 'overview' })).toBe('overview')
  })
})
