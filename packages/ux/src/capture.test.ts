// SPDX-License-Identifier: MIT
/**
 * Profile sessions stay in one browser. These tests cover the localStorage
 * snapshot, the one-capture lease, the page-level origin tracker close uses
 * to put the profile back, and the capture handle that must not close it.
 */
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { BrowserContext } from 'playwright'
import { PROFILE_LS_PREFIX, createLease, noteProfileOrigin, profileCaptureContext, profileStorageAfterClose, profileStorageInitScript, watchProfileOrigins } from './capture.js'

class MemStorage {
  private map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) ?? null) : null
  }
  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value))
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  keys(): string[] {
    return [...this.map.keys()]
  }
}

const RUN = 'run-1'
const script = profileStorageInitScript(RUN)
const href = 'http://127.0.0.1:9/reader'

/** Run the exact init script against fake web storage. */
function apply(local: MemStorage, session: MemStorage, top = true, url = href): void {
  const location = new URL(url)
  const window = { location, top: null as unknown }
  window.top = top ? window : {}
  vm.runInContext(
    script,
    vm.createContext({ window, location, localStorage: local, sessionStorage: session, JSON, Set, String, Object, Array }),
  )
}

describe('profile localStorage baseline', () => {
  it('snapshots the profile on the first tab and restores it on the next', () => {
    const local = new MemStorage()
    local.setItem('token', 'say "hi"\n')
    const first = new MemStorage()
    apply(local, first)
    expect(JSON.parse(local.getItem(PROFILE_LS_PREFIX + RUN) ?? '')).toEqual([['token', 'say "hi"\n']])
    local.setItem('token', 'changed')
    local.setItem('visited', 'yes')
    apply(local, first)
    expect(local.getItem('visited')).toBe('yes')
    apply(local, new MemStorage())
    expect(local.getItem('token')).toBe('say "hi"\n')
    expect(local.getItem('visited')).toBeNull()
  })

  it('ignores a crashed run’s key, iframes, and pages with no storage', () => {
    const local = new MemStorage()
    local.setItem(`${PROFILE_LS_PREFIX}old`, JSON.stringify([['stale', '1']]))
    local.setItem('token', 'real')
    apply(local, new MemStorage())
    expect(local.getItem(`${PROFILE_LS_PREFIX}old`)).toBeNull()
    expect(local.getItem('token')).toBe('real')
    expect(JSON.parse(local.getItem(PROFILE_LS_PREFIX + RUN) ?? '')).toEqual([['token', 'real']])

    const frame = new MemStorage()
    frame.setItem('token', 'real')
    apply(frame, new MemStorage(), false)
    expect(frame.keys().some((key) => key.startsWith(PROFILE_LS_PREFIX))).toBe(false)

    const blank = new MemStorage()
    blank.setItem('token', 'real')
    apply(blank, new MemStorage(), true, 'about:blank')
    expect(blank.keys()).toEqual(['token'])

    const broken = new MemStorage()
    broken.getItem = () => {
      throw new Error('storage disabled')
    }
    expect(() => apply(broken, new MemStorage())).not.toThrow()
  })

  it('writes back the baseline, not keys a capture added', () => {
    const prefix = PROFILE_LS_PREFIX
    expect(
      profileStorageAfterClose(
        [
          ['token', 'saved'],
          ['visited', 'yes'],
          [`${prefix}run-1`, JSON.stringify([['token', 'saved']])],
        ],
        prefix,
      ),
    ).toEqual([['token', 'saved']])
    expect(profileStorageAfterClose([['token', 'saved']], prefix)).toEqual([['token', 'saved']])
    expect(profileStorageAfterClose([[`${prefix}run-1`, 'not json'], ['token', 'saved']], prefix)).toEqual([['token', 'saved']])
  })
})

describe('profile capture lease', () => {
  it('runs one capture at a time and lets the session close wait for it', async () => {
    const lease = createLease()
    const order: string[] = []
    const release1 = await lease.acquire()
    const second = lease.acquire().then((release) => {
      order.push('second')
      release()
    })
    let joined = false
    const pending = lease.join().then(() => {
      joined = true
    })
    order.push('first')
    await Promise.resolve()
    expect(joined).toBe(false)
    release1()
    await second
    await pending
    expect(order).toEqual(['first', 'second'])
    expect(joined).toBe(true)
  })
})

interface FakePage {
  closed: boolean
  close(): Promise<void>
}

function fakeContext() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const routes: { url: unknown; handler: (...args: unknown[]) => unknown }[] = []
  const pages: FakePage[] = []
  let closed = false
  const context = {
    pages: () => pages.filter((page) => !page.closed),
    async newPage(): Promise<FakePage> {
      const page: FakePage = {
        closed: false,
        async close() {
          page.closed = true
        },
      }
      pages.push(page)
      for (const fn of [...(listeners.get('page') ?? [])]) fn(page)
      return page
    },
    async close() {
      closed = true
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      const set = listeners.get(event) ?? new Set()
      set.add(fn)
      listeners.set(event, set)
      return context
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(fn)
      return context
    },
    async route(url: unknown, handler: (...args: unknown[]) => unknown) {
      routes.push({ url, handler })
    },
    async unroute(url: unknown, handler?: (...args: unknown[]) => unknown) {
      for (let i = routes.length - 1; i >= 0; i--) {
        const route = routes[i]
        if (route && route.url === url && (handler === undefined || route.handler === handler)) routes.splice(i, 1)
      }
    },
    setDefaultTimeout(_ms: number) {},
    grantPermissions: async (_permissions: string[]) => {},
    routes,
    get closed() {
      return closed
    },
  }
  return context
}

interface OriginFrame {
  url(): string
  parentFrame(): unknown
}

interface OriginPage {
  url(): string
  events: string[]
  on(event: 'framenavigated', fn: (frame: OriginFrame) => void): void
  emit(frame: OriginFrame): void
}

/** A page that records its subscriptions. The tracker must listen here, not on the context. */
function originPage(url: string): OriginPage {
  const listeners: Array<(frame: OriginFrame) => void> = []
  const events: string[] = []
  return {
    events,
    url: () => url,
    on(event, fn) {
      events.push(event)
      listeners.push(fn)
    },
    emit(frame) {
      for (const fn of listeners) fn(frame)
    },
  }
}

describe('profile origin tracker', () => {
  it('keeps http(s) top-frame origins and drops the rest', () => {
    const seen = new Set<string>()
    noteProfileOrigin(seen, 'https://app.example/words', true)
    noteProfileOrigin(seen, 'http://127.0.0.1:9/reader', true)
    noteProfileOrigin(seen, 'https://cdn.example/frame', false)
    noteProfileOrigin(seen, 'about:blank', true)
    noteProfileOrigin(seen, 'not a url', true)
    expect([...seen].sort()).toEqual(['http://127.0.0.1:9', 'https://app.example'])
  })

  it('listens on each page, including one already open and one opened later', () => {
    const seen = new Set<string>()
    const open = originPage('https://app.example/start')
    const contextEvents: string[] = []
    const pageListeners: Array<(page: OriginPage) => void> = []
    const context = {
      pages: () => [open],
      on(event: string, fn: (page: OriginPage) => void) {
        contextEvents.push(event)
        if (event === 'page') pageListeners.push(fn)
      },
    }
    watchProfileOrigins(context as unknown as BrowserContext, seen)
    open.emit({ url: () => 'https://app.example/next', parentFrame: () => null })
    open.emit({ url: () => 'https://cdn.example/iframe', parentFrame: () => ({}) })
    const later = originPage('about:blank')
    for (const fn of pageListeners) fn(later)
    later.emit({ url: () => 'https://other.example/path', parentFrame: () => null })
    expect(contextEvents).toEqual(['page'])
    expect(open.events).toEqual(['framenavigated'])
    expect(later.events).toEqual(['framenavigated'])
    expect([...seen].sort()).toEqual(['https://app.example', 'https://other.example'])
  })
})

describe('profile capture context', () => {
  it('forwards calls, throws at the call, and closes only its own pages', async () => {
    const fake = fakeContext()
    const keep = await fake.newPage()
    let released = 0
    const handle = profileCaptureContext(fake as unknown as BrowserContext, () => {
      released++
    })
    let hits = 0
    expect(handle.on('page', () => { hits++ })).toBe(handle)
    expect(handle.setDefaultTimeout(30_000)).toBeUndefined()
    await handle.grantPermissions(['clipboard-read'])
    const handler = () => {}
    await handle.route('**/*', handler)
    const created = await handle.newPage()
    expect(hits).toBe(1)
    let once = 0
    handle.once('page', () => { once++ })
    await fake.newPage()
    await fake.newPage()
    expect(once).toBe(1)
    expect(hits).toBe(3)
    fake.setDefaultTimeout = () => {
      throw new Error('sync-fail')
    }
    expect(() => handle.setDefaultTimeout(1)).toThrow('sync-fail')
    await handle.close()
    await handle.close()
    expect(released).toBe(1)
    expect(fake.closed).toBe(false)
    expect(keep.closed).toBe(false)
    expect((created as unknown as FakePage).closed).toBe(true)
    expect(fake.routes).toEqual([])
    await fake.newPage()
    expect(hits).toBe(3)
  })
})
