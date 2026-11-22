import { describe, expect, it } from 'vitest'
import { connectedEditor } from './connectEditor'

describe('connectedEditor', () => {
  it('folds the picker once an editor has connected', () => {
    expect(connectedEditor({ connectedKeyCount: 1, endpointMismatch: false, lastSeenAt: '2026-11-18T00:00:00Z' })).toEqual({ lastSeenAt: '2026-11-18T00:00:00Z' })
  })

  it('keeps it open with no editor, or when the editor reaches the wrong server', () => {
    expect(connectedEditor({ connectedKeyCount: 0, endpointMismatch: false, lastSeenAt: null })).toBeNull()
    expect(connectedEditor({ connectedKeyCount: 2, endpointMismatch: true, lastSeenAt: null })).toBeNull()
  })
})
