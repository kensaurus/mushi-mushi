/**
 * FILE: packages/cli/src/keychain.ts
 * PURPOSE: OS-native keychain integration for Mushi CLI credentials.
 *
 * Uses @napi-rs/keyring (N-API) to store/retrieve the API key in:
 *   - macOS:   Keychain Services
 *   - Windows: Windows Credential Manager
 *   - Linux:   libsecret / Secret Service API
 *
 * Falls back gracefully to file-based storage (with ACL hardening) when:
 *   - MUSHI_NO_KEYCHAIN=1 is set
 *   - @napi-rs/keyring is not installed (optional dependency)
 *   - The platform keychain is locked / unavailable at runtime
 *
 * All public functions are synchronous — @napi-rs/keyring uses blocking
 * FFI calls that complete in <1 ms on typical systems. This lets them be
 * called from the existing synchronous loadConfig / saveConfig code paths.
 *
 * Belt-and-suspenders strategy: keys are stored in BOTH the keychain AND
 * the ACL-protected JSON file. On reads the keychain wins; the file stays
 * as a recovery path if the keychain is later unavailable.
 *
 * @napi-rs/keyring API (sync):
 *   const entry = new Entry(service, account)
 *   entry.setPassword(value: string): void
 *   entry.getPassword(): string | null
 *   entry.deletePassword(): void
 */

// Service label shown in OS Keychain / Credential Manager.
const KEYCHAIN_SERVICE = 'mushi-cli'

/**
 * Build the account name per profile so multi-profile flows are supported.
 * Format: "api-key:<profile>" → e.g. "api-key:default", "api-key:staging"
 */
function accountName(profile = 'default'): string {
  return `api-key:${profile}`
}

// The Entry constructor loaded from @napi-rs/keyring, or null if unavailable.
// Using `unknown` avoids importing a possibly-absent type declaration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _EntryClass: (new (service: string, account: string) => any) | null | undefined = undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEntryClass(): (new (service: string, account: string) => any) | null {
  if (_EntryClass === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const mod = require('@napi-rs/keyring') as any
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      _EntryClass = mod.Entry ?? null
    } catch {
      _EntryClass = null
    }
  }
  return _EntryClass ?? null
}

/**
 * Return true when the OS keychain path is enabled (default) and the
 * native module loaded without error.
 */
export function isKeychainEnabled(): boolean {
  if (process.env['MUSHI_NO_KEYCHAIN']) return false
  return getEntryClass() !== null
}

/**
 * Attempt to store `apiKey` in the OS keychain under the given profile.
 *
 * @returns true if the key was persisted to the keychain, false if the
 *          keychain is unavailable (caller must fall through to file storage).
 */
export function trySaveKeyToKeychain(apiKey: string, profile = 'default'): boolean {
  if (!apiKey) return false
  const EntryClass = getEntryClass()
  if (!EntryClass) return false
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const entry = new EntryClass(KEYCHAIN_SERVICE, accountName(profile))
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    entry.setPassword(apiKey)
    return true
  } catch {
    // Keychain locked, libsecret missing, or binary build failed — graceful fallback.
    return false
  }
}

/**
 * Attempt to read the API key for `profile` from the OS keychain.
 *
 * @returns The stored key string, or null if absent / unavailable.
 */
export function tryLoadKeyFromKeychain(profile = 'default'): string | null {
  const EntryClass = getEntryClass()
  if (!EntryClass) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const entry = new EntryClass(KEYCHAIN_SERVICE, accountName(profile))
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const key = entry.getPassword() as string | null
    return key && key.length > 0 ? key : null
  } catch {
    return null
  }
}

/**
 * Remove the stored key for `profile` from the OS keychain.
 * Best-effort — errors are swallowed (key may not be present).
 */
export function tryDeleteKeyFromKeychain(profile = 'default'): void {
  const EntryClass = getEntryClass()
  if (!EntryClass) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const entry = new EntryClass(KEYCHAIN_SERVICE, accountName(profile))
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    entry.deletePassword()
  } catch {
    // not present — ignore
  }
}
