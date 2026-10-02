import { describe, expect, it, vi } from 'vitest'
import { parseReporterEmailLink, submitReporterEmailLink } from './reporterEmailLink'

const TOKEN = 'a'.repeat(43)

describe('reporterEmailLink', () => {
  it('accepts only verify / unsubscribe with a well-formed token', () => {
    expect(parseReporterEmailLink(`?action=verify&t=${TOKEN}`)).toEqual({ action: 'verify', token: TOKEN })
    expect(parseReporterEmailLink(`?action=unsubscribe&t=${TOKEN}`)).toEqual({ action: 'unsubscribe', token: TOKEN })
    expect(parseReporterEmailLink(`?action=delete&t=${TOKEN}`)).toBeNull()
    expect(parseReporterEmailLink('?action=verify&t=short')).toBeNull()
    expect(parseReporterEmailLink("?action=verify&t=x' or 1=1")).toBeNull()
  })

  it('POSTs the token (never a GET) and returns the server copy', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: { title: "You're unsubscribed", message: 'No more emails.' } }), { status: 200 }),
    )
    const out = await submitReporterEmailLink('https://api.test', { action: 'unsubscribe', token: TOKEN }, fetchImpl as never)
    expect(out).toEqual({ ok: true, title: "You're unsubscribed", message: 'No more emails.' })
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.test/v1/public/reporter/email/unsubscribe?t=${TOKEN}`,
      expect.objectContaining({ method: 'POST', headers: { Accept: 'application/json' } }),
    )
  })

  it('shows the server reason for an expired link, and never throws offline', async () => {
    const expired = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: { code: 'LINK_EXPIRED', message: 'This link has expired.' } }), { status: 410 }),
    )
    expect(await submitReporterEmailLink('https://api.test', { action: 'verify', token: TOKEN }, expired as never)).toEqual({
      ok: false,
      message: 'This link has expired.',
    })
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect((await submitReporterEmailLink('https://api.test', { action: 'verify', token: TOKEN }, offline as never)).ok).toBe(false)
  })
})
