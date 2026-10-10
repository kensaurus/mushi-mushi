import { describe, expect, it } from 'vitest'
import { humanizeFixError } from './humanizeFixError'

describe('humanizeFixError: no relevant code', () => {
  it('points at the web search setting when the fix worker says it is off', () => {
    const h = humanizeFixError(
      'No code context. Turning on "Search the web for known fixes" in Settings → Web tools can help: the agent then also reads how others fixed this error.',
      { category: 'no_relevant_code' },
    )
    expect(h?.hint).toContain('Web search is off')
    expect(h?.action).toEqual({
      label: 'Turn on web search',
      target: { kind: 'route', to: '/settings?tab=tools', hash: 'known-issues-search' },
    })
  })

  it('keeps the re-index advice and Retry otherwise', () => {
    const h = humanizeFixError('No code context.', { category: 'no_relevant_code' })
    expect(h?.hint).toContain('Re-index')
    expect(h?.action?.target).toEqual({ kind: 'retry' })
  })
})
