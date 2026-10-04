import { describe, expect, it } from 'vitest'
import { applyAskError, askErrorMessage } from './exploreChatErrors'

describe('askErrorMessage', () => {
  it('explains the rate limit, LLM failures and cut streams in plain English', () => {
    expect(askErrorMessage({ code: 'RATE_LIMITED', message: 'x' })).toMatch(/Too many requests/)
    expect(askErrorMessage({ code: 'HTTP_429', message: 'x' })).toMatch(/Too many requests/)
    expect(askErrorMessage({ code: 'LLM_ERROR', message: 'upstream 529' })).toMatch(/AI model/)
    expect(askErrorMessage({ code: 'STREAM_EMPTY', message: 'x' })).toMatch(/stopped before it finished/)
    expect(askErrorMessage({ code: 'FORBIDDEN', message: 'Not a member of this project' })).toBe('Not a member of this project')
  })

  it('never shows a bare code', () => {
    expect(askErrorMessage({ code: 'HTTP_502', message: 'HTTP_502' })).not.toContain('HTTP_502')
  })
})

describe('applyAskError', () => {
  const user = { role: 'user' as const, content: 'q' }

  it('turns an empty streaming bubble into the error', () => {
    const out = applyAskError([user, { role: 'assistant', content: '', streaming: true }], 'Too many requests')
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ streaming: false, error: 'Too many requests', content: '' })
  })

  it('keeps a partial answer, stops the spinner and adds the error', () => {
    const out = applyAskError([user, { role: 'assistant', content: 'Half an ans', streaming: true }], 'Cut off')
    expect(out[1]).toMatchObject({ streaming: false, error: 'Cut off', content: 'Half an ans' })
  })

  it('leaves finished turns alone', () => {
    const turns = [user, { role: 'assistant' as const, content: 'done', streaming: false }]
    expect(applyAskError(turns, 'x')).toBe(turns)
  })
})
