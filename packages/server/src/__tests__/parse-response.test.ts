import { describe, expect, it } from 'vitest'

import { parseJsonResponse } from '../../supabase/functions/_shared/parse-response.ts'

describe('parseJsonResponse', () => {
  it('parses JSON object bodies', async () => {
    const res = new Response(JSON.stringify({ ok: true, snapshot_id: 'abc' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    const parsed = await parseJsonResponse(res)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.json.snapshot_id).toBe('abc')
    }
  })

  it('returns body text when upstream responds with plain-text errors', async () => {
    const res = new Response('Internal Server Error', { status: 500 })
    const parsed = await parseJsonResponse(res)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.body).toContain('Internal Server Error')
      expect(parsed.status).toBe(500)
    }
  })
})
