/**
 * The version npm has published for a package, read from the `sdk_versions`
 * catalog (GET /v1/sdk/latest-version, kept fresh by sdk-versions-cron and
 * release.yml).
 *
 * The header chip said "Latest SDK 1.39.0" from the build-time constant while
 * npm and the Home card already showed 1.39.1: the console only redeploys on
 * apps/admin changes, so a release never refreshed the constant. The chip now
 * follows the catalog and falls back to the build constant when the call
 * fails.
 */
import { useEffect, useState } from 'react'
import { apiFetch } from './supabase'

const SEMVER_RE = /^\d+\.\d+\.\d+$/
const TIMEOUT_MS = 2_500
const cache = new Map<string, Promise<string | null>>()

/** Returns the catalog's version when it is a plain semver, else the fallback. */
export function pickPublishedVersion(catalogVersion: unknown, fallback: string): string {
  return typeof catalogVersion === 'string' && SEMVER_RE.test(catalogVersion.trim())
    ? catalogVersion.trim()
    : fallback
}

/** The catalog version for `pkg`, fetched once per page session. Never rejects. */
export function getPublishedVersion(pkg: string): Promise<string | null> {
  const hit = cache.get(pkg)
  if (hit) return hit
  const pending = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await apiFetch<{ latest: string | null }>(
        `/v1/sdk/latest-version?package=${encodeURIComponent(pkg)}`,
        { scope: 'none', signal: controller.signal },
      )
      if (!res.ok) {
        cache.delete(pkg) // retry on the next mount
        return null
      }
      return res.data?.latest ?? null
    } catch {
      cache.delete(pkg)
      return null
    } finally {
      clearTimeout(timer)
    }
  })()
  cache.set(pkg, pending)
  return pending
}

/** The published version of `pkg`; `fallback` until (or unless) the catalog answers. */
export function usePublishedVersion(pkg: string, fallback: string): string {
  const [version, setVersion] = useState(fallback)
  useEffect(() => {
    let alive = true
    void getPublishedVersion(pkg).then((v) => {
      if (alive) setVersion(pickPublishedVersion(v, fallback))
    })
    return () => {
      alive = false
    }
  }, [pkg, fallback])
  return version
}

/** @internal Exported for unit tests only. */
export function resetPublishedVersionCacheForTests(): void {
  cache.clear()
}
