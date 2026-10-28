/**
 * Report 9b7624e6: the test report's page said "Upgrade the SDK to capture
 * route changes…" under Repro timeline, to a user who had installed no SDK.
 * A sample report (console test report, demo seed) says it is a sample.
 */

import { describe, expect, it } from 'vitest'
import { timelineEmpty } from './reportCaptureHints'

describe('timelineEmpty', () => {
  it('a test report says it is a sample, never "upgrade the SDK"', () => {
    const empty = timelineEmpty({ sdk_package: null, sdk_version: null, custom_metadata: { source: 'admin_test_report' } })
    expect(empty.title).toBe('Sample report: no timeline recorded')
    expect(empty.description).not.toMatch(/upgrade/i)
    expect(timelineEmpty({ sdk_package: null, sdk_version: null, custom_metadata: { source: 'mushi-marketing-seed' } }).title).toBe(
      'Sample report: no timeline recorded',
    )
  })

  it('a report from a current SDK with no events says nothing was recorded', () => {
    const empty = timelineEmpty({ sdk_package: '@mushi-mushi/web', sdk_version: '1.33.0', custom_metadata: null })
    expect(empty.description).toMatch(/No route changes, clicks, logs, or requests were recorded/)
  })

  it('a report with no SDK stamp still suggests upgrading', () => {
    expect(timelineEmpty({ sdk_package: null, sdk_version: null, custom_metadata: null }).description).toMatch(/^Upgrade the SDK/)
  })
})
