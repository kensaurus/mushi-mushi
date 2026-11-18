/**
 * FILE: apps/admin/src/lib/swUpdate.ts
 * PURPOSE: Let a new deploy take over on the user's say-so (2026-11-18). The
 *          worker used to skip waiting on every install and the "autoUpdate"
 *          register reloaded the page the moment it activated, mid-load or
 *          mid-form. Now a new worker waits; the page shows "New version —
 *          Reload"; Reload tells the waiting worker to take over and reloads
 *          once it controls the page. The page also asks for an update when
 *          the tab comes back into view, so a long-open tab finds a deploy.
 *
 * Pure: the registration, container, document and window are passed in, so
 * the logic is unit-tested without a browser (swUpdate.test.ts). Wired up in
 * lib/pwaRegister.ts; the banner is components/NewVersionBanner.tsx.
 */

interface WorkerLike {
  state: string
  postMessage(message: unknown): void
  addEventListener(type: 'statechange', listener: () => void): void
}

interface SwRegistrationLike {
  readonly waiting: WorkerLike | null
  readonly installing: WorkerLike | null
  update(): Promise<unknown>
  addEventListener(type: 'updatefound', listener: () => void): void
}

interface SwContainerLike {
  readonly controller: unknown
  addEventListener(type: 'controllerchange', listener: () => void): void
  removeEventListener(type: 'controllerchange', listener: () => void): void
}

interface Deps {
  container: SwContainerLike
  doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>
  reload: () => void
  /** Called once when a new version is waiting, with the function that applies it. */
  onReady: (apply: () => void) => void
  now?: () => number
  /** At most one update check per this many ms from focus/visibility. */
  minCheckIntervalMs?: number
}

/** Watches one registration; returns a disposer. */
export function createSwUpdater(reg: SwRegistrationLike, deps: Deps): () => void {
  const now = deps.now ?? Date.now
  const minInterval = deps.minCheckIntervalMs ?? 60_000
  let announced = false
  let reloadRequested = false
  let reloaded = false
  let lastCheck = now()

  const reloadOnce = () => {
    if (reloaded) return
    reloaded = true
    deps.reload()
  }

  const apply = () => {
    reloadRequested = true
    const waiting = reg.waiting
    // Nothing waiting (another tab already let it take over): this page still
    // runs the old bundle, so a plain reload picks up the new one.
    if (!waiting) return reloadOnce()
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  const announce = () => {
    // No controller means this is the first install, not an update.
    if (announced || !reg.waiting || !deps.container.controller) return
    announced = true
    deps.onReady(apply)
  }

  const watchInstalling = () => {
    const worker = reg.installing
    if (!worker) return
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') announce()
    })
  }

  const onControllerChange = () => {
    if (reloadRequested) reloadOnce()
  }

  const check = () => {
    const t = now()
    if (t - lastCheck < minInterval) return
    lastCheck = t
    reg.update().catch(() => undefined)
  }
  const onVisibility = () => {
    if (deps.doc.visibilityState === 'visible') check()
  }

  announce()
  reg.addEventListener('updatefound', watchInstalling)
  deps.container.addEventListener('controllerchange', onControllerChange)
  deps.doc.addEventListener('visibilitychange', onVisibility)
  deps.win.addEventListener('focus', check)

  return () => {
    deps.container.removeEventListener('controllerchange', onControllerChange)
    deps.doc.removeEventListener('visibilitychange', onVisibility)
    deps.win.removeEventListener('focus', check)
  }
}

// ── The page-wide "a new version is waiting" store, read by the banner ─────

let pendingApply: (() => void) | null = null
const listeners = new Set<() => void>()

export function publishSwUpdate(apply: () => void): void {
  pendingApply = apply
  for (const l of listeners) l()
}

export function subscribeSwUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The function that applies the waiting version, or null when none waits. */
export function getSwUpdate(): (() => void) | null {
  return pendingApply
}
