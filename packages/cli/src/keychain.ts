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

import { createRequire } from 'node:module'

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
  // The opt-out covers every keychain call, not only isKeychainEnabled().
  if (process.env['MUSHI_NO_KEYCHAIN']) return null
  if (_EntryClass === undefined) {
    try {
      // The CLI ships as an ES module, where a bare `require` does not exist:
      // it threw, the catch below swallowed it, and the keychain was silently
      // off for everyone (found 2026-10-16). createRequire works in both.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = createRequire(import.meta.url)('@napi-rs/keyring') as any
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
  return saveSecret(accountName(profile), apiKey)
}

function saveSecret(account: string, apiKey: string): boolean {
  if (!apiKey) return false
  const EntryClass = getEntryClass()
  if (!EntryClass) return false
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const entry = new EntryClass(KEYCHAIN_SERVICE, account)
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
  return loadSecret(accountName(profile))
}

function loadSecret(account: string): string | null {
  const EntryClass = getEntryClass()
  if (!EntryClass) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const entry = new EntryClass(KEYCHAIN_SERVICE, account)
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
 * @internal Exported for tests only.
 */
export function tryDeleteKeyFromKeychain(profile = 'default'): void {
  deleteSecret(accountName(profile))
}

function deleteSecret(account: string): void {
  const EntryClass = getEntryClass()
  if (!EntryClass) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const entry = new EntryClass(KEYCHAIN_SERVICE, account)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    entry.deletePassword()
  } catch {
    // not present — ignore
  }
}

/**
 * Keep the keychain in step after a command replaced the saved API key
 * (`mushi keys rotate`, `mushi config apiKey <key>`).
 *
 * loadConfig() prefers the keychain over the file, so a new key written only
 * to the file lost to the old key still in the keychain: right after a
 * rotation revoked it, every command failed with the old key. When the
 * keychain holds an entry for this profile it gets the new key; if that write
 * fails, the stale entry is removed so the file's key is used. A profile with
 * no keychain entry is left without one.
 *
 * @returns 'updated' | 'removed' | 'none' (no entry, or keychain unavailable)
 */
export function syncKeychainAfterKeyChange(apiKey: string, profile = 'default'): 'updated' | 'removed' | 'none' {
  if (tryLoadKeyFromKeychain(profile) === null) return 'none'
  if (trySaveKeyToKeychain(apiKey, profile) && tryLoadKeyFromKeychain(profile) === apiKey) return 'updated'
  tryDeleteKeyFromKeychain(profile)
  return 'removed'
}

/**
 * The local worker's key (`mushi work --daemon`, scope worker:run, ADR 0048)
 * under its own account, so it never takes the place of a profile's CLI key
 * (account `api-key:<profile>`). Same fallbacks: null / false when the
 * keychain is unavailable, and the caller uses its 0600 file instead.
 */
const WORKER_KEY_ACCOUNT = 'worker-key'

export function trySaveWorkerKey(key: string): boolean {
  return saveSecret(WORKER_KEY_ACCOUNT, key)
}

export function tryLoadWorkerKey(): string | null {
  return loadSecret(WORKER_KEY_ACCOUNT)
}

export function tryDeleteWorkerKey(): void {
  deleteSecret(WORKER_KEY_ACCOUNT)
}
