/**
 * FILE: packages/cli/src/errors.ts
 * PURPOSE: Trackable error codes and a structured error class for CLI
 *          surfacing. Every user-visible failure should flow through
 *          `MushiCliError` so the printed string includes a stable
 *          `[E_*]` code agents and humans can grep / filter on.
 *
 * Inspired by Liran Tal's nodejs-cli-apps-best-practices §6 (errors):
 *   - "Trackable errors" — each error has a stable, machine-readable code.
 *   - "Actionable errors" — every error message includes a fix hint.
 *   - "Document each error" — names + descriptions live in one place.
 */

/**
 * The closed set of CLI error codes. Adding a new code is a deliberate
 * act — keep the list small and reuse codes when possible. New codes
 * MUST be documented in the CLI README's troubleshooting section.
 */
export type CliErrorCode =
  | 'E_AUTH_MISSING'         // No API key configured (env, file, flag)
  | 'E_AUTH_INVALID'         // 401/403 from the API
  | 'E_PROJECT_MISSING'      // Project ID required but not configured
  | 'E_ENDPOINT_INVALID'     // Endpoint URL malformed or unreachable
  | 'E_NETWORK'              // Transport-level failure
  | 'E_TIMEOUT'              // Operation exceeded its time budget
  | 'E_API_ERROR'            // Server returned an envelope error
  | 'E_RATE_LIMITED'         // 429 from the API
  | 'E_FILE_NOT_FOUND'       // Local file/dir missing
  | 'E_FILE_PERMISSION'      // File read/write blocked by perms
  | 'E_INVALID_INPUT'        // User-supplied flag/arg failed validation
  | 'E_NOT_INTERACTIVE'      // Wizard requires a TTY but stdin is piped
  | 'E_INTERRUPTED'          // SIGINT/SIGTERM during a long-running op
  | 'E_FRESHNESS_STALE'      // SDK / CLI version is past its support window
  | 'E_INTERNAL'             // Unexpected; treat as a bug

/** Process exit codes mapped from each `CliErrorCode`. */
const EXIT_CODE_MAP: Record<CliErrorCode, number> = {
  E_AUTH_MISSING: 2,
  E_AUTH_INVALID: 2,
  E_PROJECT_MISSING: 2,
  E_ENDPOINT_INVALID: 2,
  E_INVALID_INPUT: 2,
  E_NOT_INTERACTIVE: 2,
  E_NETWORK: 3,
  E_TIMEOUT: 3,
  E_API_ERROR: 3,
  E_RATE_LIMITED: 3,
  E_FILE_NOT_FOUND: 1,
  E_FILE_PERMISSION: 1,
  E_FRESHNESS_STALE: 1,
  E_INTERRUPTED: 130, // 128 + SIGINT (2). POSIX convention.
  E_INTERNAL: 1,
}

/**
 * Structured CLI error. Throw or pass into `printAndExit` to surface
 * a consistent `[E_*]` code, an actionable hint, and an exit code that
 * scripts can branch on.
 *
 *   throw new MushiCliError(
 *     'E_AUTH_MISSING',
 *     'No API key found',
 *     'run `mushi init` or set MUSHI_API_KEY in your environment',
 *   )
 */
export class MushiCliError extends Error {
  readonly code: CliErrorCode
  readonly hint?: string
  readonly cause?: unknown

  constructor(code: CliErrorCode, message: string, hint?: string, cause?: unknown) {
    super(message)
    this.name = 'MushiCliError'
    this.code = code
    if (hint) this.hint = hint
    if (cause !== undefined) this.cause = cause
  }

  /** Exit code POSIX-aware shell scripts should branch on. */
  get exitCode(): number {
    return EXIT_CODE_MAP[this.code]
  }

  /**
   * Format for `--json` output. Used by the JSON writer when a CLI
   * subcommand was invoked with `--json` and an error escapes.
   */
  toJSON(): { error: { code: CliErrorCode; message: string; hint?: string } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
      },
    }
  }
}

/**
 * Print a `MushiCliError` to stderr in the canonical format and exit
 * with the matched POSIX code. Plain strings or unknown errors are
 * wrapped in `E_INTERNAL` so EVERY exit goes through the same shape.
 *
 *   $ mushi reports list
 *   error [E_AUTH_MISSING]: No API key found
 *     → fix: run `mushi init` or set MUSHI_API_KEY in your environment
 *   $ echo $?
 *   2
 */
export function printAndExit(err: unknown, asJson = false): never {
  const cliErr =
    err instanceof MushiCliError
      ? err
      : new MushiCliError(
          'E_INTERNAL',
          err instanceof Error ? err.message : String(err),
          'this is unexpected — re-run with MUSHI_DEBUG=1 and report at https://github.com/kensaurus/mushi-mushi/issues',
          err,
        )
  if (asJson) {
    process.stderr.write(JSON.stringify(cliErr.toJSON()) + '\n')
  } else {
    process.stderr.write(`error [${cliErr.code}]: ${cliErr.message}\n`)
    if (cliErr.hint) process.stderr.write(`  → fix: ${cliErr.hint}\n`)
  }
  process.exit(cliErr.exitCode)
}

/** Test helper — same shape as printAndExit but returns the formatted lines. */
export function formatError(err: unknown): { lines: string[]; exitCode: number } {
  const cliErr =
    err instanceof MushiCliError
      ? err
      : new MushiCliError('E_INTERNAL', err instanceof Error ? err.message : String(err))
  const lines = [`error [${cliErr.code}]: ${cliErr.message}`]
  if (cliErr.hint) lines.push(`  → fix: ${cliErr.hint}`)
  return { lines, exitCode: cliErr.exitCode }
}
