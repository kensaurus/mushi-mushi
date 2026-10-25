/**
 * FILE: GettingStartedEmpty.test.ts
 * PURPOSE: The first-run Plan stage says when a test report is sending or
 *          failed. A failed send is not the idle "SDK is connected" line.
 */

import { describe, expect, it } from 'vitest'
import { firstLoopPlanStatus } from './firstLoopPlanStatus'

describe('firstLoopPlanStatus', () => {
  it('keeps setup copy when the SDK is not installed', () => {
    expect(firstLoopPlanStatus(false, 'idle')).toContain('Drop the Mushi widget')
    expect(firstLoopPlanStatus(false, 'fail')).toContain('Drop the Mushi widget')
  })

  it('names a send in flight and a failed send', () => {
    expect(firstLoopPlanStatus(true, 'running')).toBe('Sending a test report…')
    expect(firstLoopPlanStatus(true, 'fail')).toBe("The test report didn't send. Retry, or wait for a real report.")
  })

  it('stays on the idle prompt before a send', () => {
    expect(firstLoopPlanStatus(true, 'idle')).toContain('SDK is connected')
    expect(firstLoopPlanStatus(true, 'pass')).toContain('SDK is connected')
  })
})
