/**
 * FILE: apps/admin/src/lib/tenantUrlSanitize.test.ts
 * PURPOSE: Boot-time tenant URL sanitization guards against XSS/SQLi query params.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { sanitizeTenantUrlParams } from './tenantUrlSanitize'

describe('sanitizeTenantUrlParams', () => {
  const originalHref = window.location.href

  beforeEach(() => {
    window.history.replaceState(null, '', '/dashboard')
  })

  afterEach(() => {
    window.history.replaceState(null, '', originalHref)
  })

  it('strips invalid org and project params', () => {
    window.history.replaceState(
      null,
      '',
      "/dashboard?org=<script>alert(1)</script>&project=' OR 1=1--&tab=list",
    )
    expect(sanitizeTenantUrlParams()).toBe(true)
    expect(window.location.search).toBe('?tab=list')
  })

  it('keeps valid UUID tenant params', () => {
    const org = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const project = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
    window.history.replaceState(null, '', `/dashboard?org=${org}&project=${project}`)
    expect(sanitizeTenantUrlParams()).toBe(false)
    expect(window.location.search).toBe(`?org=${org}&project=${project}`)
  })
})
