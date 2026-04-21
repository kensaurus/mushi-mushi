import type { MushiNodeClient } from './client'

/**
 * Wave G1 — turn Node `unhandledRejection` / `uncaughtException` events
 * into server-originated Mushi reports.
 *
 * Node's default behaviour for unhandled rejections is to terminate the
 * process on Node 15+ — we do NOT override that. We capture the event,
 * fire-and-forget a report, and let Node handle the crash as normal. That
 * keeps users' crash-loop recovery (pm2, systemd, k8s) working exactly as
 * before while giving Mushi a copy of the error for the knowledge graph.
 */
export interface UnhandledHookOptions {
  client: MushiNodeClient
  /** Label the source of the report. Defaults to `node:unhandled`. */
  component?: string
  /**
   * Opt out of the safety rails (we keep the process-terminating default
   * behaviour). Setting this to `true` makes the handler non-fatal — use
   * only if you have a better crash strategy upstream.
   */
  swallowCrashes?: boolean
}

export function attachUnhandledHook(opts: UnhandledHookOptions): () => void {
  const handler = (err: unknown, source: 'rejection' | 'exception') => {
    const e = err instanceof Error ? err : new Error(String(err))
    // We deliberately don't await — the process may be seconds away from
    // exiting. The API client's 10s timeout bounds the send. `void` is
    // intentional and documented.
    void opts.client.captureReport({
      description: `[${source}] ${e.message}`,
      userCategory: 'bug',
      severity: 'critical',
      component: opts.component ?? 'node:unhandled',
      error: { name: e.name, message: e.message, stack: e.stack },
    })
  }

  const onRejection = (reason: unknown) => handler(reason, 'rejection')
  const onException = (err: Error) => {
    handler(err, 'exception')
    if (!opts.swallowCrashes) {
      // Restore Node's default fatal behaviour. `uncaughtException` with no
      // other listeners attached terminates the process; we replicate that
      // contract.
      process.nextTick(() => { throw err })
    }
  }

  process.on('unhandledRejection', onRejection)
  process.on('uncaughtException', onException)

  return () => {
    process.off('unhandledRejection', onRejection)
    process.off('uncaughtException', onException)
  }
}
