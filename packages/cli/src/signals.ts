/**
 * FILE: packages/cli/src/signals.ts
 * PURPOSE: POSIX signal handling for the Mushi CLI. Wires SIGINT
 *          (Ctrl-C) and SIGTERM (`kill <pid>`, docker stop) into a
 *          single `AbortController` long-running commands can pass to
 *          their inner work loops.
 *
 *          Without this:
 *            $ mushi index ./src         # 10k files mid-walk
 *            ^C                          # process exits, but the
 *                                        # in-flight chunk never reports
 *                                        # back, leaving a half-uploaded
 *                                        # RAG store on the server.
 *
 *          With this:
 *            $ mushi index ./src
 *            ^C
 *            [E_INTERRUPTED] index aborted by SIGINT — partial state
 *                            on server is safe to retry.
 *
 *          Inspired by Liran Tal's nodejs-cli-apps-best-practices §1.8
 *          (POSIX-friendly process signals).
 */

import { MushiCliError } from './errors.js'

let installed = false
let activeController: AbortController | null = null

/**
 * Install one-shot SIGINT / SIGTERM listeners that abort the active
 * controller and bail out with exit code 130. Idempotent — calling
 * twice is safe; the second call is a no-op.
 *
 * Tests can call `__resetSignalHandlersForTesting()` to undo this.
 */
export function installSignalHandlers(): void {
  if (installed) return
  installed = true

  const abortAndExit = (signal: NodeJS.Signals) => {
    activeController?.abort(
      new MushiCliError(
        'E_INTERRUPTED',
        `aborted by ${signal}`,
        'partial state on the server is safe to retry — re-run the same command',
      ),
    )
    // Per POSIX, exit code = 128 + signal number. Common shells branch
    // on 130 (SIGINT) and 143 (SIGTERM) to detect user-initiated stops.
    const code = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1
    // Give the AbortController's listeners one tick to flush log lines.
    process.nextTick(() => {
      process.exit(code)
    })
  }

  process.on('SIGINT', () => abortAndExit('SIGINT'))
  process.on('SIGTERM', () => abortAndExit('SIGTERM'))
}

/**
 * Acquire the current `AbortSignal` for a long-running command. If a
 * caller passes an external `AbortController` (e.g. tests), it's used
 * verbatim. Otherwise we lazily allocate a process-wide controller
 * shared with the signal handlers.
 *
 * Each command should call `getAbortSignal()` ONCE on entry and pass
 * the returned signal into every `fetch()` and chunked walk it runs.
 */
export function getAbortSignal(external?: AbortController): AbortSignal {
  if (external) return external.signal
  if (!activeController || activeController.signal.aborted) {
    activeController = new AbortController()
  }
  return activeController.signal
}

/**
 * Test helper. Reset module state between cases.
 * @internal Exported for tests only.
 */
export function __resetSignalHandlersForTesting(): void {
  installed = false
  activeController = null
}
