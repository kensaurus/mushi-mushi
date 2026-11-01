/**
 * FILE: humanize-error-quota.test.ts
 * PURPOSE: The server copy of the fix-error wording must treat an exhausted
 *          key pool the same way the console does. The message is lowercased
 *          before matching, so the pool code has to be compared in lowercase.
 */

import { describe, expect, it } from 'vitest'
import { humanizeFixError } from '../../supabase/functions/_shared/humanize-error.ts'

describe('humanizeFixError server copy: exhausted key pool', () => {
  it('names an exhausted key pool when the code is uppercase in a lowercased message', () => {
    const h = humanizeFixError(
      'LLM failover: ALL_KEYS_EXHAUSTED for provider anthropic after 1 attempt(s). Last error: billing hard stop',
    )
    expect(h?.title).toBe('All configured API keys have hit their quota.')
    expect(h?.hint).toContain('Add a backup key')
    expect(h?.action?.label).toBe('Add backup key')
  })
})
