/**
 * Rolling session replay buffer (rrweb when available, timeline-lite fallback).
 * Lazy-loaded so the core bundle stays under the size budget.
 */

export interface ReplayCaptureOptions {
  enabled: boolean
  maxDurationMs?: number
  redactSelectors?: string[]
}

export interface ReplayCapture {
  start(): void
  stop(): void
  flush(): unknown[]
  destroy(): void
}

const DEFAULT_MAX_MS = 30_000
const MAX_EVENTS = 400

/** Minimal structural type for the optional `rrweb` dependency. We avoid a
 *  direct `import('rrweb')` type reference so the SDK type-checks and builds
 *  even when the host app has not installed rrweb. */
type RrwebRecordOptions = {
  emit: (event: unknown, isCheckout?: boolean) => void
  maskAllInputs?: boolean
  maskAllText?: boolean
  maskTextSelector?: string
  checkoutEveryNms?: number
  sampling?: Record<string, unknown>
}
type RrwebModule = {
  record?: (opts: RrwebRecordOptions) => (() => void) | undefined
}

/** rrweb event type for a full DOM snapshot. Incrementals replayed without a
 *  preceding full snapshot are unplayable, so the rolling-buffer trim must
 *  never drop below the most recent full snapshot (and its meta). */
const RRWEB_META = 4
const RRWEB_FULL_SNAPSHOT = 2

/**
 * Trim the rolling buffer to the time window without orphaning incrementals.
 * Keeps everything from the most recent full snapshot that is still old enough
 * to be the base for the visible window, then enforces a hard event ceiling
 * (again anchored to a full snapshot so the result stays playable).
 */
function trimReplayBuffer(events: unknown[], maxMs: number, maxEvents: number): void {
  const ts = (e: unknown): number | undefined => (e as { type?: number; timestamp?: number }).timestamp
  const isFullSnapshot = (e: unknown): boolean => (e as { type?: number }).type === RRWEB_FULL_SNAPSHOT
  const isMeta = (e: unknown): boolean => (e as { type?: number }).type === RRWEB_META
  const cutoff = Date.now() - maxMs

  // Latest full snapshot at/below the cutoff is the minimal base we must keep.
  let baseIndex = 0
  for (let i = 0; i < events.length; i++) {
    const t = ts(events[i])
    if (typeof t === 'number' && t >= cutoff) break
    if (isFullSnapshot(events[i])) baseIndex = isMeta(events[i - 1]) ? i - 1 : i
  }

  // Hard event ceiling: if still over budget, advance the base to a later full
  // snapshot rather than blind-shifting (which would orphan incrementals).
  if (events.length - baseIndex > maxEvents) {
    for (let i = baseIndex + 1; i < events.length; i++) {
      if (isFullSnapshot(events[i]) && events.length - i <= maxEvents) {
        baseIndex = isMeta(events[i - 1]) ? i - 1 : i
        break
      }
    }
  }

  if (baseIndex > 0) events.splice(0, baseIndex)
}

/** Lite fallback: click/route ring from DOM events when rrweb is not installed. */
function createLiteReplay(maxMs: number): ReplayCapture {
  const events: Array<{ type: string; timestamp: number; data?: Record<string, unknown> }> = []
  let active = false

  const onClick = (ev: MouseEvent) => {
    if (!active) return
    const target = ev.target instanceof Element ? ev.target : null
    const tag = target?.tagName?.toLowerCase() ?? 'unknown'
    const testId = target?.closest('[data-testid]')?.getAttribute('data-testid') ?? undefined
    events.push({ type: 'lite_click', timestamp: Date.now(), data: { tag, testId } })
    if (events.length > MAX_EVENTS) events.shift()
  }

  const stop = () => {
    active = false
    document.removeEventListener('click', onClick, true)
  }

  return {
    start() {
      if (active) return
      active = true
      document.addEventListener('click', onClick, true)
    },
    stop,
    flush() {
      const cutoff = Date.now() - maxMs
      return events.filter((e) => e.timestamp >= cutoff)
    },
    destroy() {
      stop()
      events.length = 0
    },
  }
}

let rrwebModule: RrwebModule | null = null

async function loadRrweb(): Promise<RrwebModule | null> {
  if (rrwebModule) return rrwebModule
  try {
    // `rrweb` is an optional dependency resolved only at runtime when the host
    // app installs it. The specifier is held in a variable so the bundler/TS
    // treats it as a dynamic (any) import instead of failing to resolve types.
    const specifier = 'rrweb'
    rrwebModule = (await import(/* @vite-ignore */ specifier)) as RrwebModule
    return rrwebModule
  } catch {
    return null
  }
}

export async function createReplayCapture(opts: ReplayCaptureOptions): Promise<ReplayCapture> {
  if (!opts.enabled) {
    return { start() {}, stop() {}, flush() { return [] }, destroy() {} }
  }

  const maxMs = opts.maxDurationMs ?? DEFAULT_MAX_MS
  const rrweb = await loadRrweb()
  if (!rrweb?.record) {
    return createLiteReplay(maxMs)
  }
  const record = rrweb.record

  const events: unknown[] = []
  let stopFn: (() => void) | null = null
  let recording = false

  const maskSelectors = ['input[type="password"]', ...(opts.redactSelectors ?? [])]

  const stop = () => {
    stopFn?.()
    stopFn = null
    recording = false
  }

  return {
    start() {
      if (recording) return
      recording = true
      stopFn = record({
        emit(event: unknown) {
          events.push(event)
          // Trim against the time window + hard ceiling without orphaning the
          // base full snapshot (see trimReplayBuffer). `checkoutEveryNms` below
          // forces rrweb to re-emit a full snapshot periodically so an old base
          // can be discarded while the buffer stays playable.
          trimReplayBuffer(events, maxMs, MAX_EVENTS)
        },
        maskAllInputs: true,
        // Mask rendered DOM text too — without this, rrweb records every
        // visible label (emails, names) as plaintext. Hosts that need richer
        // capture can opt out via their own rrweb integration.
        maskAllText: true,
        maskTextSelector: maskSelectors.join(','),
        // Re-emit a full snapshot roughly once per retained window so trimming
        // never leaves incrementals without a base snapshot.
        checkoutEveryNms: maxMs,
        sampling: { mousemove: false, mouseInteraction: true, scroll: 150, media: 800 },
      }) ?? null
    },
    stop,
    flush() {
      // Trim to the window (anchored to the base full snapshot) and return a
      // copy. A plain `timestamp >= cutoff` filter would drop the base
      // snapshot and yield an unplayable incrementals-only stream.
      trimReplayBuffer(events, maxMs, MAX_EVENTS)
      return [...events]
    },
    destroy() {
      stop()
      events.length = 0
    },
  }
}
