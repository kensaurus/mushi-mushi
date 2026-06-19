/**
 * FILE: sdk-versions-cron.test.ts
 * PURPOSE: Pin catalogue quarantine guard for suspicious major-version jumps.
 */

import { describe, it, expect } from 'vitest'
import { shouldQuarantineCatalogVersion } from '../../supabase/functions/_shared/sdk-catalog-guard.ts'

describe('shouldQuarantineCatalogVersion', () => {
  it('allows normal patch/minor bumps', () => {
    expect(shouldQuarantineCatalogVersion('@mushi-mushi/web', '1.7.8', '1.7.5')).toBe(false)
    expect(shouldQuarantineCatalogVersion('@mushi-mushi/react-native', '0.17.0', '0.13.1')).toBe(false)
  })

  it('quarantines >1 major jump (poison row pattern)', () => {
    expect(shouldQuarantineCatalogVersion('@mushi-mushi/react-native', '1.6.0', '0.13.1')).toBe(true)
  })

  it('does not quarantine when no existing catalogue row', () => {
    expect(shouldQuarantineCatalogVersion('@mushi-mushi/mcp', '0.4.0', null)).toBe(false)
  })
})
