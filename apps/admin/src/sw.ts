/// <reference lib="webworker" />
/**
 * FILE: apps/admin/src/sw.ts
 * PURPOSE: Service worker for the installed admin PWA (plan
 *          docs/execplans/dead-code-voice-agent-loop.md, C1 "PWA" + C5
 *          "Developer Web Push"). Built by vite-plugin-pwa in `injectManifest`
 *          mode: `self.__WB_MANIFEST` is replaced at build time with the
 *          precache list from `injectManifest.globPatterns` (app shell only —
 *          index.html, favicon, icons — never the lazy route chunks).
 *
 * Responsibilities:
 *  1. Web Share Target — Android Chrome POSTs the shared audio file
 *     (multipart/form-data, field `audio`) to `<base>voice/share`. We stash
 *     it in the Cache API under a fixed key and 303-redirect to
 *     `<base>voice?shared=1`, where VoicePage picks it up.
 *  2. Push — `push` shows a notification; `notificationclick` focuses an
 *     open console tab (navigating it) or opens a new one at `data.url`.
 *  3. App shell — network-first for navigations with the precached
 *     index.html as the offline fallback; cache-first for the few precached
 *     static files. Everything else (API, chunks, storage) is untouched.
 *
 * No Workbox runtime imports on purpose: the precache is a dozen entries and
 * a hand-rolled install/activate keeps the SW bundle a few KB (the
 * `check:bundle` budget applies to the main bundle, not the SW, but there is
 * no reason to ship 30 KB of Workbox for this).
 */

// `export {}` makes this file a module so the `self` declaration below shadows
// the WorkerGlobalScope one from lib.webworker instead of colliding with it
// (the vite-pwa TypeScript recipe). Rollup's iife output drops the empty export.
export {}

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

interface PrecacheEntry {
  url: string
  revision: string | null
}

const PRECACHE_VERSION = 'v1'
const PRECACHE_NAME = `mushi-admin-shell-${PRECACHE_VERSION}`
/** Cache + request key used to hand a shared audio file from the SW to the page.
 *  Mirrored in `lib/pwa.ts` (`takeSharedAudio`) — keep both in sync. */
const SHARE_CACHE_NAME = 'mushi-share'
const SHARE_CACHE_KEY = '/__mushi_shared_audio'

const manifest: PrecacheEntry[] = self.__WB_MANIFEST ?? []

/** Base path the SW is registered under, e.g. `/mushi-mushi/admin/` or `/`. */
function basePath(): string {
  const scope = new URL(self.registration.scope).pathname
  return scope.endsWith('/') ? scope : `${scope}/`
}

/** Resolve a precache entry to an absolute URL, revision as a cache-buster. */
function precacheUrl(entry: PrecacheEntry): string {
  const url = new URL(entry.url, self.registration.scope)
  if (entry.revision) url.searchParams.set('__WB_REVISION__', entry.revision)
  return url.href
}

function shellIndexUrl(): string | null {
  const entry = manifest.find((e) => e.url === 'index.html' || e.url.endsWith('/index.html'))
  return entry ? precacheUrl(entry) : null
}

// ── install / activate: app-shell precache ─────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE_NAME)
      await Promise.all(
        manifest.map(async (entry) => {
          const url = precacheUrl(entry)
          try {
            const res = await fetch(url, { cache: 'reload', credentials: 'same-origin' })
            if (res.ok) await cache.put(url, res)
          } catch {
            // Precache is best-effort: a single miss must not block install.
          }
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith('mushi-admin-shell-') && name !== PRECACHE_NAME)
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

// ── fetch: share target + app shell ────────────────────────────────────────

async function handleShareTarget(request: Request): Promise<Response> {
  const base = basePath()
  try {
    const form = await request.formData()
    const file = form.get('audio')
    if (file instanceof File && file.size > 0) {
      const cache = await caches.open(SHARE_CACHE_NAME)
      await cache.put(
        SHARE_CACHE_KEY,
        new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-Mushi-Filename': encodeURIComponent(file.name || 'shared-audio'),
            'X-Mushi-Shared-At': String(Date.now()),
          },
        }),
      )
      return Response.redirect(`${base}voice?shared=1`, 303)
    }
    const title = String(form.get('title') ?? '')
    const text = String(form.get('text') ?? '')
    const params = new URLSearchParams({ shared: '0' })
    if (title || text) params.set('text', `${title} ${text}`.trim().slice(0, 500))
    return Response.redirect(`${base}voice?${params.toString()}`, 303)
  } catch {
    return Response.redirect(`${base}voice?shared=0`, 303)
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  const base = basePath()

  // 1. Web Share Target (manifest share_target.action = `<base>voice/share`).
  if (request.method === 'POST' && url.pathname === `${base}voice/share`) {
    event.respondWith(handleShareTarget(request))
    return
  }

  if (request.method !== 'GET') return

  // 2. Navigations: network first, precached shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch (err) {
          const indexUrl = shellIndexUrl()
          const cached = indexUrl ? await caches.match(indexUrl) : undefined
          if (cached) return cached
          throw err
        }
      })(),
    )
    return
  }

  // 3. Precached static files: cache first.
  const entry = manifest.find((e) => new URL(e.url, self.registration.scope).pathname === url.pathname)
  if (entry) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(precacheUrl(entry))
        return cached ?? fetch(request)
      })(),
    )
  }
})

// ── push ───────────────────────────────────────────────────────────────────

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
  icon?: string
}

function parsePushPayload(event: PushEvent): PushPayload {
  if (!event.data) return {}
  try {
    const json = event.data.json() as unknown
    if (json && typeof json === 'object') return json as PushPayload
  } catch {
    // fall through to text
  }
  try {
    return { body: event.data.text() }
  } catch {
    return {}
  }
}

/** Relative `url` values resolve under the console base; absolute ones pass through. */
function resolveNotificationUrl(raw: string | undefined): string {
  const base = basePath()
  if (!raw) return new URL(`${base}voice`, self.location.origin).href
  try {
    return new URL(raw).href // absolute (e.g. a GitHub PR)
  } catch {
    const rel = raw.startsWith('/') ? raw.slice(1) : raw
    return new URL(`${base}${rel}`, self.location.origin).href
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event)
  const base = basePath()
  const title = payload.title?.trim() || 'Mushi Mushi'
  const options: NotificationOptions & { renotify?: boolean } = {
    body: payload.body ?? '',
    tag: payload.tag,
    icon: payload.icon ?? `${base}icons/icon-192.png`,
    badge: `${base}icons/icon-192.png`,
    data: { url: resolveNotificationUrl(payload.url) },
    renotify: Boolean(payload.tag),
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data as { url?: string } | undefined
  const target = data?.url ?? resolveNotificationUrl(undefined)
  const sameOrigin = target.startsWith(self.location.origin)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (sameOrigin) {
        const existing = windows.find((w) => w.url.startsWith(self.location.origin))
        if (existing) {
          await existing.focus()
          if ('navigate' in existing && existing.url !== target) {
            await existing.navigate(target).catch(() => undefined)
          }
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})

// The update flow is "autoUpdate": a new SW skips waiting on install and
// claims clients on activate (see above). A page that wants to force the
// swap can still post SKIP_WAITING.
self.addEventListener('message', (event) => {
  if (event.data && (event.data as { type?: string }).type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
