/**
 * FILE: apps/admin/src/components/dashboard/firstLoopPlanStatus.ts
 * PURPOSE: Status line for the Plan stage on the empty dashboard.
 *          A test-report send in flight or a failed send is not the idle
 *          "SDK is connected" sentence.
 */

export function firstLoopPlanStatus(
  sdkInstalled: boolean,
  testStatus: 'idle' | 'running' | 'pass' | 'fail',
): string {
  if (!sdkInstalled) {
    return 'Drop the Mushi widget into your app so end-users can flag bugs without DevTools.'
  }
  if (testStatus === 'running') return 'Sending a test report…'
  if (testStatus === 'fail') return "The test report didn't send. Retry, or wait for a real report."
  return 'SDK is connected — fire a synthetic report or wait for a real one.'
}
