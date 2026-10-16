/**
 * FILE: apps/admin/src/lib/reportCodeLocation.test.ts
 * PURPOSE: reportHasCodeLocation (BL-061). The fixtures are shortened copies
 *          of the 8 reports dispatched on 2026-10-16: 6 were refused by the
 *          review gate (no code to change), 2 opened a PR.
 */

import { describe, expect, it } from 'vitest'
import { parseStackFrames, reportHasCodeLocation } from './reportCodeLocation'
import type { ReportDetail } from '../components/report-detail/types'

function report(overrides: Partial<ReportDetail> = {}): ReportDetail {
  return {
    console_logs: null,
    network_logs: null,
    component: null,
    stage1_classification: null,
    stage2_analysis: null,
    custom_metadata: null,
    ...overrides,
  } as ReportDetail
}

const sentryLog = (stack: string) => [{ level: 'error', message: 'x', timestamp: 1, stack }]

describe('reportHasCodeLocation: no location', () => {
  it('a web-vital report (Poor FCP, nothing captured) is false', () => {
    expect(
      reportHasCodeLocation(
        report({
          title: 'Poor First Contentful Paint (FCP) of 8224.0ms on /practice page',
          description: 'Poor FCP: 8224.0 on /practice (captured by Sentry — no user description)',
          custom_metadata: { sentryFrames: [] },
        }),
      ),
    ).toBe(false)
  })

  it('a web vital whose component names only a bare file is false', () => {
    expect(
      reportHasCodeLocation(
        report({
          description: 'Poor FCP: 8260.0 on /words',
          component: 'app/words WordsContent / getWordsContentLoadingView / loading.tsx',
          custom_metadata: { sentryFrames: [] },
        }),
      ),
    ).toBe(false)
  })

  it('a message-only stack (iOS watchdog) is false', () => {
    expect(
      reportHasCodeLocation(
        report({ console_logs: sentryLog('WatchdogTermination: The OS watchdog terminated your app.') }),
      ),
    ).toBe(false)
  })

  it('a native segfault with "(?)" frames and a prose component is false', () => {
    expect(
      reportHasCodeLocation(
        report({
          console_logs: sentryLog('SIGSEGV: Segfault\n  at facebook::react::Props::initializeDynamicProps (?)\n  at <anonymous> (?)'),
          component: 'React Native Fabric renderer (Props::initializeDynamicProps) - root layout',
          custom_metadata: { sentryFrames: [] },
        }),
      ),
    ).toBe(false)
  })

  it('an Android crash with only framework frames is false', () => {
    const stack = [
      'CppException: Trying to resolve view with tag 430 which doesn\'t exist',
      '\tat com.facebook.react.fabric.FabricUIManager.resolveView(r8-map-id-e86b:14)',
      '\tat android.view.Choreographer.doFrame(Choreographer.java:1429)',
      '    at anonymous (:1:539)',
      '  at run (Choreographer.java:2086)',
    ].join('\n')
    expect(reportHasCodeLocation(report({ console_logs: sentryLog(stack), custom_metadata: { sentryFrames: [] } }))).toBe(false)
  })

  it('a stack of only dependency frames is false', () => {
    expect(
      reportHasCodeLocation(report({ console_logs: sentryLog('Error: x\n    at f (https://app.dev/node_modules/react/index.js:1:2)') })),
    ).toBe(false)
  })

  it('an info-level stack and a 200 request are false', () => {
    expect(
      reportHasCodeLocation(
        report({
          console_logs: [{ level: 'info', message: 'x', timestamp: 1, stack: 'Error\n    at f (src/a.ts:1:2)' }],
          network_logs: [{ method: 'GET', url: '/a', status: 200, duration: 1, timestamp: 1 }],
        }),
      ),
    ).toBe(false)
  })
})

describe('reportHasCodeLocation: has a location', () => {
  it('a console error with a first-party stack frame is true', () => {
    expect(
      reportHasCodeLocation(
        report({
          console_logs: [
            { level: 'error', message: 'TypeError', timestamp: 1, stack: 'TypeError: x is undefined\n    at Checkout (https://app.dev/src/checkout.tsx:42:7)' },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('a Safari/Firefox-style stack with a first-party frame is true', () => {
    const stack = 'TypeError: undefined is not an object\nrender@https://app.dev/assets/index-3f2a.js:12:340\nglobal code@https://app.dev/assets/index-3f2a.js:1:1'
    expect(reportHasCodeLocation(report({ console_logs: [{ level: 'error', message: 'x', timestamp: 1, stack }] }))).toBe(true)
  })

  it('a Safari-style stack of only dependency frames is false', () => {
    const stack = 'Error\nf@https://app.dev/node_modules/react-dom/index.js:1:2'
    expect(reportHasCodeLocation(report({ console_logs: [{ level: 'error', message: 'x', timestamp: 1, stack }] }))).toBe(false)
  })

  it('a console warn with a stack frame is true', () => {
    expect(
      reportHasCodeLocation(report({ console_logs: [{ level: 'warn', message: 'w', timestamp: 1, stack: 'w\n    at src/a.ts:1:2' }] })),
    ).toBe(true)
  })

  it('a Sentry in-app frame is true, even when the stored stack has no columns', () => {
    expect(
      reportHasCodeLocation(
        report({
          console_logs: sentryLog('TypeError: x\n  at render (app:///src/screens/Home.tsx:12)'),
          custom_metadata: { sentryFrames: ['src/screens/Home.tsx'] },
        }),
      ),
    ).toBe(true)
  })

  it('a classifier component naming a source file is true (Poor INP that got a PR)', () => {
    expect(
      reportHasCodeLocation(
        report({
          description: 'Poor INP: 432.0 on /chat',
          component: 'Chat page / ChatInput (features/chat/components/chat-input.tsx)',
        }),
      ),
    ).toBe(true)
  })

  it('a Stage-2 component naming a file is true', () => {
    expect(reportHasCodeLocation(report({ stage2_analysis: { component: 'src/lib/cart.ts' } }))).toBe(true)
  })

  it('a failed request is true, by status or by error', () => {
    expect(
      reportHasCodeLocation(report({ network_logs: [{ method: 'POST', url: '/api/pay', status: 500, duration: 1, timestamp: 1 }] })),
    ).toBe(true)
    expect(
      reportHasCodeLocation(
        report({ network_logs: [{ method: 'GET', url: '/a', status: 0, duration: 1, timestamp: 1, error: 'Failed to fetch' }] }),
      ),
    ).toBe(true)
  })
})

describe('parseStackFrames', () => {
  it('reads both V8 frame forms and skips dependency frames', () => {
    const frames = parseStackFrames(
      'Error\n    at Foo (src/foo.ts:10:5)\n    at src/bar.ts:3:1\n    at x (node_modules/y/z.js:1:1)',
    )
    expect(frames.map((f) => `${f.fn ?? ''}|${f.file}:${f.line}:${f.col}`)).toEqual(['Foo|src/foo.ts:10:5', '|src/bar.ts:3:1'])
  })
})
