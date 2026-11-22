import { afterEach, describe, it, expect } from 'vitest'
import {
  ENCRYPTED_PREFIX,
  SECURE_STORE_KEYS,
  decryptQueueBlob,
  encryptQueueBlob,
  loadReporterToken,
  saveReporterToken,
  setStorageLoadersForTests,
  type AsyncStorageLike,
  type SecureStoreLike,
} from '../storage/secure-storage'

/** expo-secure-store's own rule: it throws on any other key ("Invalid key provided to SecureStore"). */
const EXPO_KEY = /^[\w.-]+$/

function fakeSecureStore(opts: { broken?: boolean } = {}): SecureStoreLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  const check = (key: string) => {
    if (opts.broken || !EXPO_KEY.test(key)) {
      throw new Error('Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".')
    }
  }
  return {
    data,
    async getItemAsync(key) {
      check(key)
      return data.get(key) ?? null
    },
    async setItemAsync(key, value) {
      check(key)
      data.set(key, value)
    },
    async deleteItemAsync(key) {
      check(key)
      data.delete(key)
    },
  }
}

function fakeAsyncStorage(): AsyncStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    async getItem(key) {
      return data.get(key) ?? null
    },
    async setItem(key, value) {
      data.set(key, value)
    },
    async removeItem(key) {
      data.delete(key)
    },
  }
}

afterEach(() => setStorageLoadersForTests(null))

describe('secure storage queue format', () => {
  it('uses a versioned encrypted prefix for at-rest queue blobs', () => {
    expect(ENCRYPTED_PREFIX).toBe('mushi_enc_v1:')
  })
})

describe('SecureStore keys (2026-11-16: "@mushi:…" threw on every call)', () => {
  it('every key passed to SecureStore is one expo-secure-store accepts', () => {
    for (const key of SECURE_STORE_KEYS) expect(key).toMatch(EXPO_KEY)
  })

  it('a reporter token saved once is the same token on the next launch', async () => {
    const secure = fakeSecureStore()
    const storage = fakeAsyncStorage()
    setStorageLoadersForTests({ secure: async () => secure, async: async () => storage })
    expect(await loadReporterToken(true)).toBeNull()
    await saveReporterToken('mushi_abc', true)
    expect(await loadReporterToken(true)).toBe('mushi_abc')
    expect([...secure.data.values()]).toEqual(['mushi_abc'])
  })

  it('moves an older AsyncStorage token into SecureStore', async () => {
    const secure = fakeSecureStore()
    const storage = fakeAsyncStorage()
    storage.data.set('@mushi:reporter_token', 'mushi_old')
    setStorageLoadersForTests({ secure: async () => secure, async: async () => storage })
    expect(await loadReporterToken(true)).toBe('mushi_old')
    expect(storage.data.has('@mushi:reporter_token')).toBe(false)
    expect(await loadReporterToken(true)).toBe('mushi_old')
  })

  it('when SecureStore refuses, the token is kept in AsyncStorage and survives a restart', async () => {
    const secure = fakeSecureStore({ broken: true })
    const storage = fakeAsyncStorage()
    setStorageLoadersForTests({ secure: async () => secure, async: async () => storage })
    await saveReporterToken('mushi_kept', true)
    expect(await loadReporterToken(true)).toBe('mushi_kept')
  })

  it('a queued report is stored and read back, encrypted when it can be and plain when SecureStore refuses', async () => {
    const storage = fakeAsyncStorage()
    const secure = fakeSecureStore()
    setStorageLoadersForTests({ secure: async () => secure, async: async () => storage })
    const secret = await encryptQueueBlob('[{"id":"r1"}]', true)
    if (typeof globalThis.crypto?.subtle?.importKey === 'function') expect(secret.startsWith(ENCRYPTED_PREFIX)).toBe(true)
    expect(await decryptQueueBlob(secret, true)).toBe('[{"id":"r1"}]')

    setStorageLoadersForTests({ secure: async () => fakeSecureStore({ broken: true }), async: async () => storage })
    const plain = await encryptQueueBlob('[{"id":"r2"}]', true)
    expect(plain).toBe('[{"id":"r2"}]')
    expect(await decryptQueueBlob(plain, true)).toBe('[{"id":"r2"}]')
  })
})
