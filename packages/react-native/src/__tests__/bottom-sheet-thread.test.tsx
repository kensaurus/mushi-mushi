/**
 * FILE: packages/react-native/src/__tests__/bottom-sheet-thread.test.tsx
 * PURPOSE: Renders MushiBottomSheet and walks the "Your reports" thread
 *          through loading → error → Retry → loaded (Plan 018 success
 *          criterion 6; completeness gap #33). reporter-thread.test.ts covers
 *          the load helpers only; this drives the component itself.
 *
 * OVERVIEW:
 * - The package has no React renderer for Node (no react-dom or
 *   react-test-renderer), and this suite adds no dependency. So `react`'s
 *   hooks are swapped for a small in-test runtime (state slots, refs,
 *   memoised callbacks, effects with dependency checks and cleanup), and the
 *   real component function is called to produce its element tree.
 * - `react-native` primitives are host strings, as in provider.test.tsx;
 *   the tree is walked to read text and to call `onPress`, the way a tap
 *   would.
 * - `useMushiContext` returns a fake client whose thread load is a promise
 *   the test settles by hand, so each state is observed, not just the end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as ReactModule from 'react'
import type { ReactElement } from 'react'
import { reporterCopy } from '@mushi-mushi/core/reporter-ui'
import type { MushiReporterReport } from '@mushi-mushi/core'
import type { MushiReporterReportDetail, MushiReporterTimelineItem } from '@mushi-mushi/core/reporter-channels'
import { getLocale } from '@mushi-mushi/web/i18n'

// ── Hook runtime ─────────────────────────────────────────────────────────────

type Deps = readonly unknown[] | undefined
interface StateSlot { kind: 'state'; value: unknown; set: (next: unknown) => void }
interface RefSlot { kind: 'ref'; ref: { current: unknown } }
interface MemoSlot { kind: 'memo'; value: unknown; deps: Deps }
interface EffectSlot { kind: 'effect'; deps: Deps; cleanup: (() => void) | undefined }
type Slot = StateSlot | RefSlot | MemoSlot | EffectSlot

// Hoisted: the component's static import pulls in `react` (and so this
// mock's factory) before the module body runs.
const { rt, hooks } = vi.hoisted(() => {
  const rt = {
    slots: [] as unknown[],
    index: 0,
    dirty: false,
    pending: [] as Array<{ slot: unknown; run: () => unknown }>,
  }

  function depsChanged(prev: Deps, next: Deps): boolean {
    if (!prev || !next) return true
    if (prev.length !== next.length) return true
    return prev.some((v, i) => !Object.is(v, next[i]))
  }

  function slotAt<T extends Slot>(make: () => T): T {
    const i = rt.index++
    if (rt.slots[i] === undefined) rt.slots[i] = make()
    return rt.slots[i] as T
  }

  const hooks = {
    useState<T>(init: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const slot = slotAt<StateSlot>(() => {
        const s: StateSlot = {
          kind: 'state',
          value: typeof init === 'function' ? (init as () => T)() : init,
          set: (next) => {
            const value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(s.value) : next
            if (!Object.is(value, s.value)) {
              s.value = value
              rt.dirty = true
            }
          },
        }
        return s
      })
      return [slot.value as T, slot.set as (next: T | ((prev: T) => T)) => void]
    },
    useRef<T>(init: T): { current: T } {
      return slotAt<RefSlot>(() => ({ kind: 'ref', ref: { current: init } })).ref as { current: T }
    },
    useCallback<T>(fn: T, deps: Deps): T {
      const slot = slotAt<MemoSlot>(() => ({ kind: 'memo', value: fn, deps }))
      if (depsChanged(slot.deps, deps)) {
        slot.value = fn
        slot.deps = deps
      }
      return slot.value as T
    },
    useEffect(run: () => unknown, deps: Deps): void {
      let fresh = false
      const slot = slotAt<EffectSlot>(() => {
        fresh = true
        return { kind: 'effect', deps, cleanup: undefined }
      })
      if (fresh || depsChanged(slot.deps, deps)) {
        slot.deps = deps
        rt.pending.push({ slot, run })
      }
    },
  }
  return { rt, hooks }
})

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof ReactModule>()
  return { ...real, default: real, ...hooks }
})

// ── react-native host primitives ─────────────────────────────────────────────

vi.mock('react-native', () => {
  const animation = () => ({ start: (cb?: () => void) => cb?.() })
  return {
    Modal: 'Modal',
    View: 'View',
    Text: 'Text',
    TextInput: 'TextInput',
    Image: 'Image',
    TouchableOpacity: 'TouchableOpacity',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    ScrollView: 'ScrollView',
    Animated: {
      View: 'Animated.View',
      Value: class {
        constructor(public value: number) {}
        setValue(v: number) {
          this.value = v
        }
      },
      spring: animation,
      timing: animation,
      parallel: animation,
    },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    StyleSheet: { create: <T,>(styles: T) => styles },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
    Platform: { OS: 'ios' },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(true),
      addEventListener: () => ({ remove: () => undefined }),
    },
    useColorScheme: () => 'light',
  }
})

// ── Fake client ──────────────────────────────────────────────────────────────

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const REPORT: MushiReporterReport = {
  id: 'rep-1',
  status: 'classified',
  title: 'Checkout button does nothing',
  created_at: '2026-10-01T10:00:00Z',
}

const client = {
  detailCalls: [] as Array<{ reportId: string; settle: Deferred<unknown> }>,
}

function makeClient() {
  return {
    listMyReports: vi.fn(async () => [REPORT]),
    loadMyReportDetail: vi.fn((reportId: string) => {
      const d = deferred<unknown>()
      client.detailCalls.push({ reportId, settle: d })
      return d.promise
    }),
    markReportRead: vi.fn(async () => 1),
    replyToReport: vi.fn(),
  }
}
let mushi = makeClient()

vi.mock('../provider', () => ({ useMushiContext: () => mushi }))

import { MushiBottomSheet, type MushiBottomSheetProps } from '../components/MushiBottomSheet'

// ── Tree helpers ─────────────────────────────────────────────────────────────

interface El {
  type: unknown
  props: Record<string, unknown>
}

function isEl(node: unknown): node is El {
  return typeof node === 'object' && node !== null && 'type' in node && 'props' in node
}

function* walk(node: unknown): Generator<El> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n)
    return
  }
  if (!isEl(node)) return
  yield node
  yield* walk(node.props.children)
}

function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isEl(node)) return textOf(node.props.children)
  return ''
}

let tree: unknown = null
let props: MushiBottomSheetProps

function renderOnce() {
  rt.index = 0
  rt.pending = []
  tree = MushiBottomSheet(props) as ReactElement
  const effects = rt.pending
  rt.pending = []
  for (const { slot, run } of effects) {
    const s = slot as EffectSlot
    s.cleanup?.()
    const out = run()
    s.cleanup = typeof out === 'function' ? (out as () => void) : undefined
  }
}

/** Let promises settle and re-render until state stops changing. */
async function flush() {
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 0))
    if (!rt.dirty) return
    rt.dirty = false
    renderOnce()
  }
  throw new Error('render loop did not settle')
}

function screenText(): string {
  return textOf(tree)
}

function pressByText(label: string) {
  const target = [...walk(tree)].find((el) => typeof el.props.onPress === 'function' && textOf(el).includes(label))
  if (!target) throw new Error(`no pressable with text "${label}" in: ${screenText()}`)
  ;(target.props.onPress as () => void)()
}

function findByA11yLabel(label: string): El | undefined {
  return [...walk(tree)].find((el) => el.props.accessibilityLabel === label)
}

const t = getLocale()
const rc = reporterCopy('en')

async function openThread() {
  props = { visible: true, onClose: () => undefined, preferredTab: 'inbox' }
  renderOnce()
  await flush()
  expect(screenText()).toContain(REPORT.title as string)
  pressByText(REPORT.title as string)
  rt.dirty = false
  renderOnce()
}

beforeEach(() => {
  rt.slots = []
  rt.index = 0
  rt.dirty = false
  rt.pending = []
  client.detailCalls = []
  mushi = makeClient()
})

describe('MushiBottomSheet thread', () => {
  it('shows a loading skeleton while the thread loads, then the timeline', async () => {
    await openThread()

    // Loading: the labelled skeleton, no error, no Retry.
    expect(findByA11yLabel(t.flows.reports.loading)).toBeDefined()
    expect(screenText()).not.toContain(rc.ui.loadError)
    expect(mushi.loadMyReportDetail).toHaveBeenCalledWith('rep-1')

    const timeline: MushiReporterTimelineItem[] = [
      { kind: 'comment', at: '2026-10-02T10:00:00Z', text: 'Fixed in 1.4 — please update.', custom: true, comment_id: 'c1' },
    ]
    const detail: MushiReporterReportDetail = { report: { id: 'rep-1', status: 'classified' }, timeline } as MushiReporterReportDetail
    client.detailCalls[0].settle.resolve(detail)
    await flush()

    expect(findByA11yLabel(t.flows.reports.loading)).toBeUndefined()
    expect(screenText()).toContain('Fixed in 1.4 — please update.')
    expect(screenText()).toContain(rc.ui.developer)
    // Opening a loaded thread marks it read.
    expect(mushi.markReportRead).toHaveBeenCalledWith('rep-1')
  })

  it('shows the error with a Retry that reloads the thread', async () => {
    await openThread()
    client.detailCalls[0].settle.reject(new Error('network down'))
    await flush()

    // Error: message announced as an alert, skeleton gone, Retry offered.
    expect(screenText()).toContain(rc.ui.loadError)
    const alert = [...walk(tree)].find((el) => el.props.accessibilityRole === 'alert' && textOf(el) === rc.ui.loadError)
    expect(alert).toBeDefined()
    expect(findByA11yLabel(t.flows.reports.loading)).toBeUndefined()
    // A failed load does not mark anything read.
    expect(mushi.markReportRead).not.toHaveBeenCalled()

    // Retry → back to loading, a second request for the same report.
    pressByText(rc.ui.retry)
    rt.dirty = false
    renderOnce()
    expect(findByA11yLabel(t.flows.reports.loading)).toBeDefined()
    expect(screenText()).not.toContain(rc.ui.loadError)
    expect(client.detailCalls.map((c) => c.reportId)).toEqual(['rep-1', 'rep-1'])

    // The retry succeeds with no replies yet.
    client.detailCalls[1].settle.resolve({ report: { id: 'rep-1', status: 'classified' }, timeline: [] })
    await flush()
    expect(screenText()).not.toContain(rc.ui.loadError)
    expect(screenText()).toContain(rc.ui.noReplies)
    expect(mushi.markReportRead).toHaveBeenCalledTimes(1)
  })

  it('keeps Retry available when the retry fails too', async () => {
    await openThread()
    client.detailCalls[0].settle.reject(new Error('down'))
    await flush()
    pressByText(rc.ui.retry)
    rt.dirty = false
    renderOnce()
    client.detailCalls[1].settle.reject(new Error('still down'))
    await flush()
    expect(screenText()).toContain(rc.ui.loadError)
    expect(() => pressByText(rc.ui.retry)).not.toThrow()
    expect(client.detailCalls).toHaveLength(3)
  })

  it('a slow answer for a thread the reporter left does not replace the list', async () => {
    await openThread()
    pressByText(t.widget.back)
    rt.dirty = false
    renderOnce()
    client.detailCalls[0].settle.reject(new Error('late failure'))
    await flush()
    expect(screenText()).not.toContain(rc.ui.loadError)
    expect(screenText()).toContain(REPORT.title as string)
  })
})
