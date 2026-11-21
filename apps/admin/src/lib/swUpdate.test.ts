/**
 * A new deploy's worker waits for the user's Reload (2026-11-18): announce
 * only an update (never the first install), post SKIP_WAITING on Reload,
 * reload exactly once when the new worker takes control, never on our own,
 * and look for an update when the tab comes back (throttled).
 */
import { describe, expect, it, vi } from 'vitest'
import { createSwUpdater, entryScriptPath, getSwUpdate, pageRunsDeployedBuild, publishSwUpdate, subscribeSwUpdate } from './swUpdate'

type L = () => void

function target() {
  const map = new Map<string, Set<L>>()
  return {
    addEventListener: (type: string, l: L) => {
      if (!map.has(type)) map.set(type, new Set())
      map.get(type)!.add(l)
    },
    removeEventListener: (type: string, l: L) => map.get(type)?.delete(l),
    fire: (type: string) => map.get(type)?.forEach((l) => l()),
    count: (type: string) => map.get(type)?.size ?? 0,
  }
}

function worker(state = 'installing') {
  return { state, postMessage: vi.fn(), ...target() }
}

function setup(opts: { controlled?: boolean; waiting?: ReturnType<typeof worker> | null; installing?: ReturnType<typeof worker> | null } = {}) {
  const reg = {
    waiting: opts.waiting ?? null,
    installing: (opts.installing ?? null) as ReturnType<typeof worker> | null,
    update: vi.fn(() => Promise.resolve()),
    ...target(),
  }
  const container = { controller: opts.controlled === false ? null : {}, ...target() }
  const doc = { visibilityState: 'visible' as DocumentVisibilityState, ...target() }
  const win = target()
  const reload = vi.fn()
  const onReady = vi.fn()
  let t = 0
  const dispose = createSwUpdater(reg, {
    container,
    doc: doc as never,
    win: win as never,
    reload,
    onReady,
    now: () => t,
    minCheckIntervalMs: 1000,
  })
  return { reg, container, doc, win, reload, onReady, dispose, tick: (ms: number) => (t += ms) }
}

describe('createSwUpdater', () => {
  it('announces a worker already waiting when the page loads', () => {
    const { onReady, reload } = setup({ waiting: worker('installed') })
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it('announces a worker that finishes installing, but not the very first install', () => {
    const s = setup()
    const w = worker()
    s.reg.installing = w
    s.reg.fire('updatefound')
    w.state = 'installed'
    s.reg.waiting = w
    w.fire('statechange')
    expect(s.onReady).toHaveBeenCalledTimes(1)

    const first = setup({ controlled: false })
    const w2 = worker()
    first.reg.installing = w2
    first.reg.fire('updatefound')
    w2.state = 'installed'
    first.reg.waiting = w2
    w2.fire('statechange')
    expect(first.onReady).not.toHaveBeenCalled()
  })

  it('announces a worker that was already installing before it started watching', () => {
    const w = worker()
    const s = setup({ installing: w })
    expect(s.onReady).not.toHaveBeenCalled()
    w.state = 'installed'
    s.reg.waiting = w
    w.fire('statechange')
    expect(s.onReady).toHaveBeenCalledTimes(1)
  })

  it('on Reload posts SKIP_WAITING and reloads once when the new worker takes control', () => {
    const waiting = worker('installed')
    const s = setup({ waiting })
    const apply = s.onReady.mock.calls[0]![0] as () => void
    apply()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(s.reload).not.toHaveBeenCalled()
    s.container.fire('controllerchange')
    s.container.fire('controllerchange')
    expect(s.reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads on a controller change the user did not ask for', () => {
    const s = setup({ waiting: worker('installed') })
    s.container.fire('controllerchange')
    expect(s.reload).not.toHaveBeenCalled()
  })

  it('reloads straight away when nothing is waiting any more (another tab took it)', () => {
    const s = setup({ waiting: worker('installed') })
    const apply = s.onReady.mock.calls[0]![0] as () => void
    s.reg.waiting = null
    apply()
    expect(s.reload).toHaveBeenCalledTimes(1)
  })

  it('looks for an update on focus and when the tab becomes visible, at most once per interval', () => {
    const s = setup()
    s.win.fire('focus')
    expect(s.reg.update).not.toHaveBeenCalled() // just loaded: the browser checked already
    s.tick(1500)
    s.win.fire('focus')
    expect(s.reg.update).toHaveBeenCalledTimes(1)
    s.doc.fire('visibilitychange')
    expect(s.reg.update).toHaveBeenCalledTimes(1)
    s.tick(1500)
    s.doc.visibilityState = 'hidden'
    s.doc.fire('visibilitychange')
    expect(s.reg.update).toHaveBeenCalledTimes(1)
    s.doc.visibilityState = 'visible'
    s.doc.fire('visibilitychange')
    expect(s.reg.update).toHaveBeenCalledTimes(2)
  })

  it('removes its page listeners on dispose', () => {
    const s = setup()
    s.dispose()
    expect(s.container.count('controllerchange')).toBe(0)
    expect(s.doc.count('visibilitychange')).toBe(0)
    expect(s.win.count('focus')).toBe(0)
  })
})

describe('the new-version store', () => {
  it('tells subscribers when a version is waiting', () => {
    const listener = vi.fn()
    const off = subscribeSwUpdate(listener)
    const apply = vi.fn()
    publishSwUpdate(apply)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getSwUpdate()).toBe(apply)
    off()
  })
})

// Console audit 2026-11-21: "New version ready" showed on the newest build, on
// every first load after a deploy, because navigations are network first.
describe("pageRunsDeployedBuild", () => {
  const base = "https://kensaur.us/mushi-mushi/admin/"
  const shell = (entry: string) =>
    `<!doctype html><html><head><link rel="modulepreload" href="/mushi-mushi/admin/assets/vendor-1.js"><script type="module" crossorigin src="${entry}"></script></head><body></body></html>`

  it("reads the entry script path from the shell", () => {
    expect(entryScriptPath(shell("/mushi-mushi/admin/assets/index-NEW.js"), base)).toBe("/mushi-mushi/admin/assets/index-NEW.js")
    expect(entryScriptPath(shell("./assets/index-REL.js"), base)).toBe("/mushi-mushi/admin/assets/index-REL.js")
    expect(entryScriptPath("<html></html>", base)).toBeNull()
  })

  it("is true when the page runs the entry the server serves now", async () => {
    await expect(pageRunsDeployedBuild({ fetchShell: async () => shell("/mushi-mushi/admin/assets/index-NEW.js"), runningEntry: "/mushi-mushi/admin/assets/index-NEW.js", baseUrl: base })).resolves.toBe(true)
  })

  it("is false when the page is behind, or anything is unknown", async () => {
    await expect(pageRunsDeployedBuild({ fetchShell: async () => shell("/mushi-mushi/admin/assets/index-NEW.js"), runningEntry: "/mushi-mushi/admin/assets/index-OLD.js", baseUrl: base })).resolves.toBe(false)
    await expect(pageRunsDeployedBuild({ fetchShell: async () => { throw new Error("offline") }, runningEntry: "/mushi-mushi/admin/assets/index-NEW.js", baseUrl: base })).resolves.toBe(false)
    await expect(pageRunsDeployedBuild({ fetchShell: async () => "<html></html>", runningEntry: "/mushi-mushi/admin/assets/index-NEW.js", baseUrl: base })).resolves.toBe(false)
    await expect(pageRunsDeployedBuild({ fetchShell: async () => shell("/x.js"), runningEntry: null, baseUrl: base })).resolves.toBe(false)
  })
})
