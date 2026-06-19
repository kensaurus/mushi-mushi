/**
 * FILE: sdk-observation.test.ts
 * PURPOSE: Pin SDK observation validation, merge logic, and idempotent
 *          replacement rules used by the projects list freshness pipeline.
 */

import { describe, it, expect } from 'vitest'
import {
  isValidSdkObservation,
  shouldReplaceObservation,
  resolveProjectSdkIdentity,
  SDK_SEED_VERSION,
} from '../../supabase/functions/_shared/sdk-observation.ts'

describe('isValidSdkObservation', () => {
  it('rejects missing fields and QA seed sentinel', () => {
    expect(isValidSdkObservation(null, '1.0.0')).toBe(false)
    expect(isValidSdkObservation('@mushi-mushi/web', null)).toBe(false)
    expect(isValidSdkObservation('@mushi-mushi/react-native', SDK_SEED_VERSION)).toBe(false)
  })

  it('accepts stamped @mushi-mushi/* semver rows', () => {
    expect(isValidSdkObservation('@mushi-mushi/react-native', '0.13.1')).toBe(true)
    expect(isValidSdkObservation('@mushi-mushi/web', '1.7.8')).toBe(true)
  })

  it('rejects unknown packages and non-semver versions', () => {
    expect(isValidSdkObservation('@other/pkg', '1.0.0')).toBe(false)
    expect(isValidSdkObservation('@mushi-mushi/web', 'latest')).toBe(false)
  })
})

describe('shouldReplaceObservation', () => {
  it('replaces when incoming observed_at is newer', () => {
    expect(
      shouldReplaceObservation(
        { sdk_version: '0.13.0', observed_at: '2026-06-01T00:00:00Z' },
        { sdk_version: '0.13.1', observed_at: '2026-06-13T00:00:00Z' },
      ),
    ).toBe(true)
  })

  it('does not replace when incoming is older', () => {
    expect(
      shouldReplaceObservation(
        { sdk_version: '0.13.1', observed_at: '2026-06-13T00:00:00Z' },
        { sdk_version: '0.13.0', observed_at: '2026-06-01T00:00:00Z' },
      ),
    ).toBe(false)
  })

  it('at same timestamp prefers higher semver', () => {
    const ts = '2026-06-13T08:21:00Z'
    expect(
      shouldReplaceObservation(
        { sdk_version: '0.13.0', observed_at: ts },
        { sdk_version: '0.13.1', observed_at: ts },
      ),
    ).toBe(true)
  })
})

describe('resolveProjectSdkIdentity', () => {
  it('prefers curated observation over stamped report fallback', () => {
    const resolved = resolveProjectSdkIdentity(
      {
        project_id: 'p1',
        sdk_package: '@mushi-mushi/react-native',
        sdk_version: '0.14.0',
        source: 'heartbeat',
        observed_at: '2026-06-18T00:00:00Z',
      },
      {
        project_id: 'p1',
        created_at: '2026-06-13T00:00:00Z',
        sdk_package: '@mushi-mushi/react-native',
        sdk_version: '0.13.1',
      },
    )
    expect(resolved.sdk_version).toBe('0.14.0')
    expect(resolved.sdk_observation_source).toBe('heartbeat')
  })

  it('falls back to stamped report when observation table is empty', () => {
    const resolved = resolveProjectSdkIdentity(undefined, {
      project_id: 'p1',
      created_at: '2026-06-13T00:00:00Z',
      sdk_package: '@mushi-mushi/react-native',
      sdk_version: '0.13.1',
    })
    expect(resolved.sdk_version).toBe('0.13.1')
    expect(resolved.sdk_observation_source).toBe('report_fallback')
  })

  it('returns unknown when latest report is unstamped (yen-yen regression)', () => {
    const resolved = resolveProjectSdkIdentity(undefined, {
      project_id: 'yen-yen',
      created_at: '2026-06-17T00:00:00Z',
      sdk_package: null,
      sdk_version: null,
    })
    expect(resolved.sdk_package).toBeNull()
    expect(resolved.sdk_version).toBeNull()
    expect(resolved.sdk_observation_source).toBeNull()
  })
})
