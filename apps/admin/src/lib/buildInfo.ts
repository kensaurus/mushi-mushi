/**
 * FILE: apps/admin/src/lib/buildInfo.ts
 * PURPOSE: What this console is and where it runs, for the sidebar stamp and
 *          the version popover (owner, 2026-11-19: "show the version … up to
 *          the hh:mm … and style somewhere on the sidebar — self-hosted or
 *          deployed").
 *
 *          - Console build: version, commit and build instant come from Vite
 *            defines (vite.config.ts). Guarded with `typeof` so unit tests,
 *            which have no defines, still import this module.
 *          - Server: GET {api}/health answers `{ version, deployed_at, mode }`
 *            (api/routes/discovery.ts). `mode` is the server's own answer
 *            (_shared/instance-mode.ts); the console's build-time guess
 *            (lib/env.ts) is only the fallback while it loads or if it fails.
 */

import { useEffect, useState } from 'react'
import { RESOLVED_API_URL, checkEnv } from './env'

export type DeploymentMode = 'hosted' | 'self-hosted'

export interface ConsoleBuild {
  version: string
  sha: string
  /** ISO instant, or null when the build did not stamp one. */
  builtAt: string | null
}

export function consoleBuild(): ConsoleBuild {
  return {
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
    sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev',
    builtAt: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : null,
  }
}

/**
 * "2026-11-19 14:32 JST" in the viewer's own time zone. The zone name keeps a
 * screenshot unambiguous. Returns null for a missing or unparseable instant.
 */
export function formatStamp(iso: string | null | undefined, timeZone?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(d)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`.trim()
}

/** Short label for a mode: "Hosted" (Mushi Cloud) or "Self-hosted". */
export function modeLabel(mode: DeploymentMode): string {
  return mode === 'hosted' ? 'Hosted' : 'Self-hosted'
}

/** The console's own guess, used until the server answers. */
export function buildTimeMode(): DeploymentMode {
  return checkEnv().mode === 'self-hosted' ? 'self-hosted' : 'hosted'
}

export interface ServerInstance {
  mode: DeploymentMode
  /** Commit the server deploy was stamped with; 'dev' when unstamped. */
  version: string | null
  deployedAt: string | null
}

/** Parses the /health body; anything unexpected becomes null fields, never a throw. @internal Exported for tests. */
export function parseHealth(body: unknown): ServerInstance | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const mode = b.mode === 'hosted' || b.mode === 'self-hosted' ? b.mode : null
  if (!mode) return null
  return {
    mode,
    version: typeof b.version === 'string' ? b.version : null,
    deployedAt: typeof b.deployed_at === 'string' ? b.deployed_at : null,
  }
}

let cached: Promise<ServerInstance | null> | null = null

/** One /health read per page load; a failure resolves null (the guess stays). */
export function fetchServerInstance(): Promise<ServerInstance | null> {
  if (!cached) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    cached = fetch(`${RESOLVED_API_URL}/health`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(parseHealth)
      .catch(() => null)
      .finally(() => clearTimeout(timer))
  }
  return cached
}

export function useServerInstance(): ServerInstance | null {
  const [server, setServer] = useState<ServerInstance | null>(null)
  useEffect(() => {
    let live = true
    void fetchServerInstance().then((s) => {
      if (live) setServer(s)
    })
    return () => {
      live = false
    }
  }, [])
  return server
}
