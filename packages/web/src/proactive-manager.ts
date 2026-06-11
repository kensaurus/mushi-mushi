export interface ProactiveConfig {
  maxProactivePerSession: number
  dismissCooldownHours: number
  suppressAfterDismissals: number
  /**
   * Cross-reload re-show cooldown, in minutes. When a proactive trigger is
   * granted a show, the SDK persists a `mushi:lastShown` timestamp. On a fresh
   * session (a brand-new JS context after a page reload or crash, before this
   * manager has shown anything itself) prompts are suppressed if one was shown
   * within this window — even if the user never cleanly dismissed it.
   *
   * The 24h `dismissCooldownHours` only engages once `recordDismissal()` runs,
   * which requires a clean widget `onClose`. A reloading/broken page tears down
   * the JS context before that, so without this guard the panel re-pops on every
   * load. Set to `0` to disable (legacy behavior). Defaults to 30 minutes.
   */
  reshowCooldownMinutes: number
}

export interface ProactiveManager {
  shouldShow(triggerType: string): boolean
  recordDismissal(): void
  recordSubmission(): void
  reset(): void
}

const STORAGE_KEY_LAST_DISMISS = 'mushi:lastDismiss'
const STORAGE_KEY_CONSEC_DISMISS = 'mushi:consecDismiss'
const STORAGE_KEY_LAST_SHOWN = 'mushi:lastShown'

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}

export function createProactiveManager(
  config: Partial<ProactiveConfig> = {},
): ProactiveManager {
  const maxPerSession = config.maxProactivePerSession ?? 2
  const cooldownHours = config.dismissCooldownHours ?? 24
  const suppressThreshold = config.suppressAfterDismissals ?? 3
  const reshowCooldownMs = (config.reshowCooldownMinutes ?? 30) * 60 * 1000

  let sessionPromptCount = 0
  const sessionTriggerTypes = new Set<string>()

  function shouldShow(triggerType: string): boolean {
    const now = Date.now()

    // Permanent suppression check
    const consecDismissals = parseInt(readStorage(STORAGE_KEY_CONSEC_DISMISS) ?? '0', 10)
    if (consecDismissals >= suppressThreshold) return false

    // Cooldown check
    const lastDismiss = readStorage(STORAGE_KEY_LAST_DISMISS)
    if (lastDismiss) {
      const elapsed = now - parseInt(lastDismiss, 10)
      if (elapsed < cooldownHours * 60 * 60 * 1000) return false
    }

    // Cross-reload re-show guard. Only applies on a FRESH session (this manager
    // hasn't shown anything yet) — i.e. a brand-new JS context after a reload or
    // crash. If a prompt was shown very recently in a prior context, the user
    // was almost certainly interrupted before a clean dismissal could persist
    // the 24h cooldown; suppressing here stops a broken/reloading page from
    // re-popping the panel on every load. Within a live session the existing
    // per-session limit/dedup below governs instead, so this never blocks a
    // second distinct trigger in the same context.
    if (reshowCooldownMs > 0 && sessionPromptCount === 0) {
      const lastShown = readStorage(STORAGE_KEY_LAST_SHOWN)
      if (lastShown) {
        const elapsed = now - parseInt(lastShown, 10)
        if (elapsed < reshowCooldownMs) return false
      }
    }

    // Session limit
    if (sessionPromptCount >= maxPerSession) return false

    // Dedup: same trigger type not shown twice per session
    if (sessionTriggerTypes.has(triggerType)) return false

    sessionTriggerTypes.add(triggerType)
    sessionPromptCount++
    writeStorage(STORAGE_KEY_LAST_SHOWN, String(now))
    return true
  }

  function recordDismissal(): void {
    writeStorage(STORAGE_KEY_LAST_DISMISS, String(Date.now()))
    const current = parseInt(readStorage(STORAGE_KEY_CONSEC_DISMISS) ?? '0', 10)
    writeStorage(STORAGE_KEY_CONSEC_DISMISS, String(current + 1))
  }

  function recordSubmission(): void {
    writeStorage(STORAGE_KEY_CONSEC_DISMISS, '0')
  }

  function reset(): void {
    sessionPromptCount = 0
    sessionTriggerTypes.clear()
    // reset() is an explicit teardown / re-init (destroy()), not a page reload,
    // so clear the cross-reload timestamp too — a deliberate fresh start should
    // be eligible to prompt again rather than inheriting the prior context's
    // suppression window.
    try { localStorage.removeItem(STORAGE_KEY_LAST_SHOWN) } catch { /* noop */ }
  }

  return { shouldShow, recordDismissal, recordSubmission, reset }
}
