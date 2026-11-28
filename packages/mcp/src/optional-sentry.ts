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
  init(options: SentryInitOptions): unknown
}

/**
 * Both supported majors are passed the same object. `@sentry/node` 10 reads
 * `sendDefaultPii`; 11 removed it and reads `dataCollection`, whose defaults
 * collect user info, headers, bodies and MCP tool content. Each major ignores
 * the key it does not know, so the privacy posture is the same on both.
 */
interface SentryInitOptions {
  dsn: string
  environment: string
  tracesSampleRate: number
  sendDefaultPii: false
  attachStacktrace: false
  dataCollection: Record<string, unknown>
}

/** Collect nothing beyond the error itself (the v10 `sendDefaultPii: false` behaviour). */
const DATA_COLLECTION_OFF = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} as const

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
    sendDefaultPii: false,
    attachStacktrace: false,
    dataCollection: DATA_COLLECTION_OFF,
  })
  return 'enabled'
}
