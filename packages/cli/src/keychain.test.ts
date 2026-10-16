/**
 * FILE: packages/cli/src/keychain.test.ts
 * PURPOSE: The OS keychain is actually reachable from the ESM build, and a
 *          command that replaces the saved key keeps the keychain in step.
 *
 * Why (2026-10-16): the CLI loaded @napi-rs/keyring with a bare `require`,
 * which does not exist in an ES module, so the keychain was silently off for
 * every user; and `mushi keys rotate` / `mushi config apiKey` wrote the new
 * key only to the file, which would lose to the old key in the keychain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// An in-memory stand-in for the OS keychain, served through createRequire.
const store = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  failWrites: false,
}))

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>()
  class FakeEntry {
    constructor(
      private service: string,
      private account: string,
    ) {}
    private get id() {
      return `${this.service}/${this.account}`
    }
    setPassword(value: string) {
      if (store.failWrites) throw new Error('keychain locked')
      store.entries.set(this.id, value)
    }
    getPassword() {
      return store.entries.get(this.id) ?? null
    }
    deletePassword() {
      store.entries.delete(this.id)
    }
  }
  return {
    ...actual,
    createRequire: () => (id: string) => {
      if (id === '@napi-rs/keyring') return { Entry: FakeEntry }
      throw new Error(`unexpected require ${id}`)
    },
  }
})

beforeEach(() => {
  vi.resetModules()
  store.entries.clear()
  store.failWrites = false
  delete process.env['MUSHI_NO_KEYCHAIN']
})
afterEach(() => {
  vi.resetModules()
})

describe('keychain', () => {
  it('loads the native module from the ES module build', async () => {
    const { isKeychainEnabled, trySaveKeyToKeychain, tryLoadKeyFromKeychain } = await import('./keychain.js')
    expect(isKeychainEnabled()).toBe(true)
    expect(trySaveKeyToKeychain('mushi_old', 'default')).toBe(true)
    expect(tryLoadKeyFromKeychain('default')).toBe('mushi_old')
  })

  it('moves the keychain to the new key after a rotation', async () => {
    const { syncKeychainAfterKeyChange, trySaveKeyToKeychain, tryLoadKeyFromKeychain } = await import('./keychain.js')
    trySaveKeyToKeychain('mushi_old', 'default')
    expect(syncKeychainAfterKeyChange('mushi_new', 'default')).toBe('updated')
    expect(tryLoadKeyFromKeychain('default')).toBe('mushi_new')
  })

  it('removes a stale entry it cannot overwrite, so the file key wins', async () => {
    const { syncKeychainAfterKeyChange, trySaveKeyToKeychain, tryLoadKeyFromKeychain } = await import('./keychain.js')
    trySaveKeyToKeychain('mushi_old', 'default')
    store.failWrites = true
    expect(syncKeychainAfterKeyChange('mushi_new', 'default')).toBe('removed')
    expect(tryLoadKeyFromKeychain('default')).toBeNull()
  })

  it('does not create an entry for a profile that never had one', async () => {
    const { syncKeychainAfterKeyChange, tryLoadKeyFromKeychain } = await import('./keychain.js')
    expect(syncKeychainAfterKeyChange('mushi_new', 'staging')).toBe('none')
    expect(tryLoadKeyFromKeychain('staging')).toBeNull()
  })

  it('stays off when MUSHI_NO_KEYCHAIN is set', async () => {
    process.env['MUSHI_NO_KEYCHAIN'] = '1'
    const { isKeychainEnabled } = await import('./keychain.js')
    expect(isKeychainEnabled()).toBe(false)
  })
})
