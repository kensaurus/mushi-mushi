/**
 * FILE: apps/admin/src/lib/fixDeepLink.test.ts
 * PURPOSE: QA #66. The palette, Activity drawer and Ask Mushi linked a fix
 *          three different ways and the Fixes page read none of them. Links
 *          now share one shape; the page reads it and every legacy form.
 */

import { describe, expect, it } from 'vitest'
import { fixDeepLinkPath, fixRowDomId, readFixDeepLinkId } from './fixDeepLink'

const ID = '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d'

function read(url: string): string | null {
  const parsed = new URL(url, 'https://console.test')
  return readFixDeepLinkId(parsed.searchParams, parsed.hash)
}

describe('fix deep links', () => {
  it('round-trips the canonical link and opens the Attempts tab', () => {
    const path = fixDeepLinkPath(ID)
    expect(path).toContain('tab=attempts')
    expect(read(path)).toBe(ID)
  })

  it('reads the legacy forms still sitting in Slack messages and bookmarks', () => {
    expect(read(`/fixes#${ID}`)).toBe(ID) // command palette
    expect(read(`/fixes?expand=${ID}`)).toBe(ID) // Activity drawer
    expect(read(`/fixes?highlight=${ID}`)).toBe(ID) // audit log
    expect(read(`/fixes?status=failed#fix-${ID}`)).toBe(ID) // failed summary
  })

  it('ignores plain list links and junk', () => {
    expect(read('/fixes')).toBeNull()
    expect(read('/fixes?status=failed')).toBeNull()
    expect(read('/fixes#top')).toBeNull()
    expect(read('/fixes?fix=<script>')).toBeNull()
  })

  it('names the row the page scrolls to', () => {
    expect(fixRowDomId(ID)).toBe(`fix-${ID}`)
  })
})
