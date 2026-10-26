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
let interrupted: NodeJS.Signals | null = null

type InterruptCleanup = (signal: NodeJS.Signals) => unknown
const cleanups = new Set<InterruptCleanup>()

/**
 * How long cleanups get before the process exits anyway: well inside
 * systemd's (90 s) and Docker's (10 s) stop timeouts.
 */
export const INTERRUPT_CLEANUP_MS = 8_000

/**
 * Run `fn` when SIGINT / SIGTERM arrives, before the process exits: e.g.
 * close a server-side record the command opened, so it does not sit
 * "running" until a reaper finds it. Cleanups run together and get
 * INTERRUPT_CLEANUP_MS; a second signal exits at once. API calls made from
 * a cleanup work: the aborted controller is replaced on the next
 * `getAbortSignal()`. Returns the function that unregisters it.
 */
export function onInterrupt(fn: InterruptCleanup): () => void {
  cleanups.add(fn)
  return () => {
    cleanups.delete(fn)
  }
}

/** The signal that stopped this process, or null: work in flight checks it before its next step. */
export function interruptedBy(): NodeJS.Signals | null {
  return interrupted
}

/**
 * @internal Exported for tests only. Abort in-flight requests, give the
 * registered cleanups their time, then exit with 128 + the signal number.
 */
export async function handleInterrupt(
  signal: NodeJS.Signals,
  exit: (code: number) => void = (code) => process.exit(code),
  budgetMs = INTERRUPT_CLEANUP_MS,
): Promise<void> {
  // Per POSIX, exit code = 128 + signal number. Common shells branch
  // on 130 (SIGINT) and 143 (SIGTERM) to detect user-initiated stops.
  const code = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1
  if (interrupted) {
    exit(code)
    return
  }
  interrupted = signal
  activeController?.abort(
    new MushiCliError(
      'E_INTERRUPTED',
      `aborted by ${signal}`,
      'partial state on the server is safe to retry — re-run the same command',
    ),
  )
  if (cleanups.size) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, budgetMs)
    })
    const all = Promise.allSettled([...cleanups].map(async (fn) => fn(signal)))
    await Promise.race([all, budget])
    clearTimeout(timer)
  }
  // Give the AbortController's listeners one tick to flush log lines.
  await new Promise<void>((resolve) => process.nextTick(resolve))
  exit(code)
}

/**
 * Install SIGINT / SIGTERM listeners that abort the active controller,
 * run the registered cleanups and exit with 130 / 143. Idempotent —
 * calling twice is safe; the second call is a no-op.
 *
 * Tests can call `__resetSignalHandlersForTesting()` to undo this.
 */
export function installSignalHandlers(): void {
  if (installed) return
  installed = true

  process.on('SIGINT', () => void handleInterrupt('SIGINT'))
  process.on('SIGTERM', () => void handleInterrupt('SIGTERM'))
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
  interrupted = null
  cleanups.clear()
}
