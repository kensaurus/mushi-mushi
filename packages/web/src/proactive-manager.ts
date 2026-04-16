export interface ProactiveConfig {
  maxProactivePerSession: number
  dismissCooldownHours: number
  suppressAfterDismissals: number
}

export interface ProactiveManager {
  shouldShow(triggerType: string): boolean
  recordDismissal(): void
  recordSubmission(): void
  reset(): void
}

const STORAGE_KEY_LAST_DISMISS = 'mushi:lastDismiss'
const STORAGE_KEY_CONSEC_DISMISS = 'mushi:consecDismiss'

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

  let sessionPromptCount = 0
  const sessionTriggerTypes = new Set<string>()

  function shouldShow(triggerType: string): boolean {
    // Permanent suppression check
    const consecDismissals = parseInt(readStorage(STORAGE_KEY_CONSEC_DISMISS) ?? '0', 10)
    if (consecDismissals >= suppressThreshold) return false

    // Cooldown check
    const lastDismiss = readStorage(STORAGE_KEY_LAST_DISMISS)
    if (lastDismiss) {
      const elapsed = Date.now() - parseInt(lastDismiss, 10)
      if (elapsed < cooldownHours * 60 * 60 * 1000) return false
    }

    // Session limit
    if (sessionPromptCount >= maxPerSession) return false

    // Dedup: same trigger type not shown twice per session
    if (sessionTriggerTypes.has(triggerType)) return false

    sessionTriggerTypes.add(triggerType)
    sessionPromptCount++
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
  }

  return { shouldShow, recordDismissal, recordSubmission, reset }
}
