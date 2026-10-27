/**
 * Mushi report 8aa2c40a: the Hono adapter's context type had no `text()` or
 * `json()`, so the documented fallback `(err, c) => c.text('Server error',
 * 500)` did not type-check. This file is type-checked by `tsc --noEmit`
 * (it mounts the handler on a real Hono app) and runs the app once.
 */
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { MushiNodeClient } from '../client'
import { mushiHonoErrorHandler } from '../hono'

function stubClient() {
  const captureReport = vi.fn().mockResolvedValue(undefined)
  return { client: { captureReport } as unknown as MushiNodeClient, captureReport }
}

describe('mushiHonoErrorHandler on a Hono app', () => {
  it('reports the error and answers with the c.text() fallback', async () => {
    const { client, captureReport } = stubClient()
    const app = new Hono()
    app.get('/boom', () => { throw new Error('checkout exploded') })
    app.onError(mushiHonoErrorHandler({ client }, (_err, c) => c.text('Server error', 500)))

    const res = await app.request('/boom')
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Server error')
    expect(captureReport).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('checkout exploded'),
      component: 'node:hono',
    }))
  })

  it('accepts a c.json() fallback', async () => {
    const { client } = stubClient()
    const app = new Hono()
    app.get('/boom', () => { throw new Error('nope') })
    app.onError(mushiHonoErrorHandler({ client }, (err, c) => c.json({ ok: false, error: err.message }, 500)))

    const res = await app.request('/boom')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'nope' })
  })
})
