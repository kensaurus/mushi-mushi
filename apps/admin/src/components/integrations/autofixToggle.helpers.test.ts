/**
 * FILE: apps/admin/src/components/integrations/autofixToggle.helpers.test.ts
 * PURPOSE: Unit-test the optimistic-update / rollback logic for the autofix
 *          toggle. The toggle uses optimistic UI: flip the local state
 *          immediately, then revert if the API call fails.
 */

import { describe, it, expect, vi } from 'vitest'

// ── In-memory optimistic toggle ───────────────────────────────────────────────

interface ToggleState {
  enabled: boolean
  saving: boolean
  error: string | null
}

interface ToggleResult {
  ok: boolean
  data?: { autofix_enabled: boolean }
  error?: string
}

/**
 * Simulates the optimistic toggle logic in the integrations UI:
 * 1. Flip `enabled` immediately (optimistic)
 * 2. Call the API
 * 3. On success: keep the new value (already set in step 1)
 * 4. On failure: rollback to the previous value and set error
 */
async function optimisticToggle(
  current: ToggleState,
  apiFn: (newValue: boolean) => Promise<ToggleResult>,
): Promise<ToggleState> {
  const previous = current.enabled
  const optimistic: ToggleState = { enabled: !previous, saving: true, error: null }

  try {
    const result = await apiFn(optimistic.enabled)
    if (result.ok && result.data) {
      return { enabled: result.data.autofix_enabled, saving: false, error: null }
    }
    // API returned non-ok response
    return { enabled: previous, saving: false, error: result.error ?? 'Toggle failed' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error'
    return { enabled: previous, saving: false, error: msg }
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('optimisticToggle', () => {
  it('enables when currently disabled — success path', async () => {
    const state: ToggleState = { enabled: false, saving: false, error: null }
    const api = vi.fn().mockResolvedValue({ ok: true, data: { autofix_enabled: true } })
    const next = await optimisticToggle(state, api)
    expect(next.enabled).toBe(true)
    expect(next.saving).toBe(false)
    expect(next.error).toBeNull()
    expect(api).toHaveBeenCalledWith(true)
  })

  it('disables when currently enabled — success path', async () => {
    const state: ToggleState = { enabled: true, saving: false, error: null }
    const api = vi.fn().mockResolvedValue({ ok: true, data: { autofix_enabled: false } })
    const next = await optimisticToggle(state, api)
    expect(next.enabled).toBe(false)
    expect(api).toHaveBeenCalledWith(false)
  })

  it('rolls back to previous value on API error response', async () => {
    const state: ToggleState = { enabled: false, saving: false, error: null }
    const api = vi.fn().mockResolvedValue({ ok: false, error: 'FORBIDDEN' })
    const next = await optimisticToggle(state, api)
    expect(next.enabled).toBe(false) // rolled back
    expect(next.error).toBe('FORBIDDEN')
    expect(next.saving).toBe(false)
  })

  it('rolls back on network throw', async () => {
    const state: ToggleState = { enabled: true, saving: false, error: null }
    const api = vi.fn().mockRejectedValue(new Error('fetch failed'))
    const next = await optimisticToggle(state, api)
    expect(next.enabled).toBe(true) // rolled back to true
    expect(next.error).toBe('fetch failed')
  })

  it('uses server-returned value (not the local optimistic flip) on success', async () => {
    // Edge case: server says false even though we sent true — trust the server
    const state: ToggleState = { enabled: false, saving: false, error: null }
    const api = vi.fn().mockResolvedValue({ ok: true, data: { autofix_enabled: false } })
    const next = await optimisticToggle(state, api)
    expect(next.enabled).toBe(false) // server wins
  })

  it('clears previous error on successful toggle', async () => {
    const state: ToggleState = { enabled: false, saving: false, error: 'Previous error' }
    const api = vi.fn().mockResolvedValue({ ok: true, data: { autofix_enabled: true } })
    const next = await optimisticToggle(state, api)
    expect(next.error).toBeNull()
  })
})
