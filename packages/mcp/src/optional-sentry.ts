/**
 * FILE: packages/mcp/src/optional-sentry.ts
 * PURPOSE: Opt-in Sentry for the stdio binary. `@sentry/node` is an optional
 *          peer dependency: it (and its OpenTelemetry tree, about half of
 *          this package's install size) is only loaded when the operator sets
 *          MUSHI_MCP_SENTRY_DSN, so a plain `npx @mushi-mushi/mcp` neither
 *          installs nor imports it.
 */

/** The slice of `@sentry/node` this module uses. */
interface SentryModule {
  init(options: { dsn: string; environment: string; tracesSampleRate: number }): unknown
}

export type OptionalSentryStatus = 'disabled' | 'enabled' | 'unavailable'

export interface OptionalSentryDeps {
  /** Loads `@sentry/node`. Overridable so tests never touch the real SDK. */
  importSentry?: () => Promise<SentryModule>
  /** Receives one line when a DSN is set but the SDK cannot be loaded. */
  warn: (message: string, meta: Record<string, unknown>) => void
}

/**
 * Initialise Sentry when MUSHI_MCP_SENTRY_DSN is set. Returns what happened:
 *   - 'disabled'    no DSN — `@sentry/node` is never imported;
 *   - 'enabled'     the SDK loaded and `init` ran with the same options the
 *                   binary used when Sentry was a hard dependency;
 *   - 'unavailable' a DSN is set but `@sentry/node` is not installed; the
 *                   server keeps running and says how to install it.
 */
export async function initOptionalSentry(
  env: Readonly<Record<string, string | undefined>>,
  deps: OptionalSentryDeps,
): Promise<OptionalSentryStatus> {
  const dsn = env.MUSHI_MCP_SENTRY_DSN?.trim()
  if (!dsn) return 'disabled'
  const importSentry = deps.importSentry ?? (() => import('@sentry/node') as Promise<SentryModule>)
  let sentry: SentryModule
  try {
    sentry = await importSentry()
  } catch (err) {
    deps.warn(
      'MUSHI_MCP_SENTRY_DSN is set but @sentry/node is not installed — error reporting is off. ' +
        'Install it next to the server (npm i @sentry/node, or npx -p @sentry/node -p @mushi-mushi/mcp mushi-mcp).',
      { err: err instanceof Error ? err.message : String(err) },
    )
    return 'unavailable'
  }
  sentry.init({
    dsn,
    environment: env.MUSHI_SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
  })
  return 'enabled'
}
