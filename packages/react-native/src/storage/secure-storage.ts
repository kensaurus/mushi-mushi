const REPORTER_TOKEN_KEY = '@mushi:reporter_token'
const QUEUE_CRYPTO_KEY = '@mushi:queue_aes_key'
const LEGACY_QUEUE_KEY = '@mushi:offline_queue'
export const ENCRYPTED_QUEUE_KEY = '@mushi:offline_queue_enc'

const ENCRYPTED_PREFIX = 'mushi_enc_v1:'

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export type { AsyncStorageLike }

type SecureStoreLike = {
  getItemAsync: (key: string) => Promise<string | null>
  setItemAsync: (key: string, value: string) => Promise<void>
  deleteItemAsync: (key: string) => Promise<void>
}

async function loadAsyncStorage(): Promise<AsyncStorageLike | null> {
  try {
    const mod = await import('@react-native-async-storage/async-storage')
    return mod.default
  } catch {
    return null
  }
}

async function loadSecureStore(): Promise<SecureStoreLike | null> {
  try {
    // `expo-secure-store` is an optional peer dependency. The `as string` cast
    // keeps the literal specifier in the emitted bundle (so Metro still resolves
    // it for consumers who install it) while telling TypeScript not to require
    // the package to be present in this workspace at type-check time.
    const mod = await import('expo-secure-store' as string)
    return (mod.default ?? mod) as SecureStoreLike
  } catch {
    return null
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  if (typeof btoa === 'function') return btoa(binary)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer
  if (B) return B.from(bytes).toString('base64')
  return ''
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof atob === 'function') {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer
  if (B) return new Uint8Array(B.from(b64, 'base64'))
  return new Uint8Array()
}

function hasWebCrypto(): boolean {
  return typeof globalThis.crypto?.subtle?.importKey === 'function'
}

async function getOrCreateQueueKey(secure: SecureStoreLike): Promise<CryptoKey | null> {
  if (!hasWebCrypto()) return null
  let rawB64 = await secure.getItemAsync(QUEUE_CRYPTO_KEY)
  if (!rawB64) {
    const raw = new Uint8Array(32)
    globalThis.crypto.getRandomValues(raw)
    rawB64 = bytesToBase64(raw)
    await secure.setItemAsync(QUEUE_CRYPTO_KEY, rawB64)
  }
  const raw = base64ToBytes(rawB64)
  return globalThis.crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptQueueBlob(plaintext: string, secureStorage: boolean): Promise<string> {
  if (!secureStorage) return plaintext
  const secure = await loadSecureStore()
  if (!secure) return plaintext
  const key = await getOrCreateQueueKey(secure)
  if (!key) return plaintext
  const iv = new Uint8Array(12)
  globalThis.crypto.getRandomValues(iv)
  const encoded = new TextEncoder().encode(plaintext)
  const cipher = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  const combined = new Uint8Array(iv.length + cipher.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(cipher), iv.length)
  return ENCRYPTED_PREFIX + bytesToBase64(combined)
}

export async function decryptQueueBlob(stored: string, _secureStorage: boolean): Promise<string> {
  // The ENCRYPTED_PREFIX is the source of truth: if a blob was written
  // encrypted, it MUST be decrypted here even if the caller has since toggled
  // `secureStorage` off. Gating on the current flag returned the still-encrypted
  // string, which then failed JSON.parse upstream and silently wiped the offline
  // queue (data loss). Plaintext blobs (no prefix) pass straight through.
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored
  const secure = await loadSecureStore()
  if (!secure || !hasWebCrypto()) return stored
  const key = await getOrCreateQueueKey(secure)
  if (!key) return stored
  const combined = base64ToBytes(stored.slice(ENCRYPTED_PREFIX.length))
  if (combined.length < 13) return stored
  const iv = combined.slice(0, 12)
  const cipher = combined.slice(12)
  try {
    const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
    return new TextDecoder().decode(plain)
  } catch {
    return stored
  }
}

/** Load reporter token from SecureStore with one-time migration from AsyncStorage. */
export async function loadReporterToken(secureStorage: boolean): Promise<string | null> {
  if (secureStorage) {
    const secure = await loadSecureStore()
    if (secure) {
      const fromSecure = await secure.getItemAsync(REPORTER_TOKEN_KEY)
      if (fromSecure?.startsWith('mushi_')) return fromSecure
      const storage = await loadAsyncStorage()
      if (storage) {
        const legacy = await storage.getItem(REPORTER_TOKEN_KEY)
        if (legacy?.startsWith('mushi_')) {
          await secure.setItemAsync(REPORTER_TOKEN_KEY, legacy)
          await storage.removeItem(REPORTER_TOKEN_KEY)
          return legacy
        }
      }
      return fromSecure
    }
  }
  const storage = await loadAsyncStorage()
  if (!storage) return null
  return storage.getItem(REPORTER_TOKEN_KEY)
}

/** Persist reporter token — SecureStore when enabled, else AsyncStorage. */
export async function saveReporterToken(token: string, secureStorage: boolean): Promise<void> {
  if (secureStorage) {
    const secure = await loadSecureStore()
    if (secure) {
      await secure.setItemAsync(REPORTER_TOKEN_KEY, token)
      const storage = await loadAsyncStorage()
      if (storage) await storage.removeItem(REPORTER_TOKEN_KEY)
      return
    }
  }
  const storage = await loadAsyncStorage()
  if (storage) await storage.setItem(REPORTER_TOKEN_KEY, token)
}

export { LEGACY_QUEUE_KEY, REPORTER_TOKEN_KEY, ENCRYPTED_PREFIX }
