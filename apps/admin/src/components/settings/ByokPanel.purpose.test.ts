/**
 * FILE: apps/admin/src/components/settings/ByokPanel.purpose.test.ts
 * PURPOSE: Each AI key card says what the key does under the saved "Run AI on"
 *          choice. With OpenAI chosen, the cards said Claude "drafts the fix"
 *          and OpenAI was only a "backup", right under "No Claude key is used"
 *          (journey walk, 2026-11-28).
 */

import { describe, expect, it } from 'vitest'
import { providerPurpose } from './ByokPanel'

describe('providerPurpose', () => {
  it('with Claude chosen (or not loaded yet), Claude drafts the fix and OpenAI backs it up', () => {
    for (const choice of ['anthropic', null] as const) {
      expect(providerPurpose('anthropic', choice)).toContain('drafts the fix')
      expect(providerPurpose('openai', choice)).toContain('Backup when Anthropic is unavailable')
    }
  })

  it('with OpenAI chosen, OpenAI runs every step and Claude is not used', () => {
    expect(providerPurpose('openai', 'openai')).toContain('Runs every AI step')
    expect(providerPurpose('openai', 'openai')).not.toContain('Backup')
    expect(providerPurpose('anthropic', 'openai')).toContain('Not used while "Run AI on" is OpenAI')
  })

  it('leaves the other providers as they are', () => {
    expect(providerPurpose('cursor', 'openai')).toContain('Cursor cloud agent')
  })
})
