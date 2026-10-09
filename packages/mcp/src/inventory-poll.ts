// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/mcp/src/inventory-poll.ts
 * PURPOSE: Poll the project's inventory and report when its `updatedAt`
 *          changes, so the stdio entry point can send
 *          notifications/resources/updated for inventory://current.
 *
 * A 401 or 403 does not heal while the process runs (the key lacks mcp:read,
 * or was revoked), so the poll stops after one warning. Until 2026-09-22 it
 * dropped every non-OK response and retried each minute: one ingest-only key
 * produced 1,038 refused requests in 17 hours, and nobody was told why
 * inventory notifications never arrived. Other failures (5xx, network) are
 * transient and keep the poll alive.
 */

interface PollLog {
  warn(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

export interface InventoryPollOptions {
  apiEndpoint: string
  apiKey: string
  projectId: string
  /** Sent as X-Mushi-Client (`mcp-stdio/<version>`), like every other stdio request. */
  clientVersion: string
  /** Called when updatedAt changes after the first successful read. */
  onUpdated: (updatedAt: string) => Promise<void> | void
  isShuttingDown: () => boolean
  log: PollLog
  fetch?: typeof globalThis.fetch
  intervalMs?: number
}

export interface InventoryPoll {
  stop(): void
  /** Resolves when the in-flight poll (if any) settles. For tests. */
  settled(): Promise<void>
}

export function startInventoryPoll(options: InventoryPollOptions): InventoryPoll {
  const doFetch = options.fetch ?? globalThis.fetch
  let lastUpdatedAt: string | null = null
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  let inFlight: Promise<void> = Promise.resolve()

  const stop = (): void => {
    stopped = true
    if (timer) clearInterval(timer)
  }

  const pollOnce = async (): Promise<void> => {
    if (stopped || options.isShuttingDown()) return
    try {
      const res = await doFetch(`${options.apiEndpoint}/v1/admin/inventory/${options.projectId}`, {
        headers: {
          'X-Mushi-Api-Key': options.apiKey,
          'X-Mushi-Project-Id': options.projectId,
          'X-Mushi-Client': `mcp-stdio/${options.clientVersion}`,
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 401 || res.status === 403) {
        stop()
        options.log.warn(
          'inventory://current change notifications are off: the API key cannot read this ' +
            "project's inventory (it needs the mcp:read scope). Restart with such a key to turn them on.",
          { status: res.status },
        )
        return
      }
      if (!res.ok) return
      const data = (await res.json()) as { data?: { updatedAt?: string } }
      const updatedAt = data?.data?.updatedAt ?? null
      if (!updatedAt || updatedAt === lastUpdatedAt) return
      const isFirstRead = lastUpdatedAt === null
      lastUpdatedAt = updatedAt
      if (!isFirstRead) await options.onUpdated(updatedAt)
    } catch (err) {
      options.log.debug('inventory poll failed', { err: String(err) })
    }
  }

  const tick = (): void => {
    inFlight = pollOnce()
  }

  tick()
  // unref: the poll alone must never keep the process alive (see
  // serveUntilClosed in index.ts); a live MCP session keeps stdin open anyway.
  timer = setInterval(tick, options.intervalMs ?? 60_000)
  timer.unref?.()
  if (stopped) clearInterval(timer)

  return { stop, settled: () => inFlight }
}
