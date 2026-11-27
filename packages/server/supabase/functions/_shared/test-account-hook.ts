/**
 * FILE: packages/server/supabase/functions/_shared/test-account-hook.ts
 * PURPOSE: A project's own test-account hook (ADR 0073). A first-time user
 *          test signs up only with an account the app itself made for it,
 *          because an account in Mushi's sign-in is useless to an app with its
 *          own backend. A project that opts in (`fresh_eyes_accounts = 'hook'`)
 *          gives an https address; when a worker claims a test an owner or
 *          admin started with test accounts, Mushi asks that address for one
 *          account per visitor, passes it to the worker once and never stores
 *          the password. When the run ends Mushi asks the hook to delete them
 *          (the hook must delete them by `expires_at` on its own too).
 *
 *   POST <hook>   X-Mushi-Event: mushi.test_account.create
 *                 X-Mushi-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>
 *     { event, project_id, run_id, visitor, expires_at, persona: { name, locale } | null }
 *     → 200 { email, password, name?, id? }
 *   POST <hook>   X-Mushi-Event: mushi.test_account.expire
 *     { event, project_id, run_id, accounts: ["<id or email>", …] }
 *     → any 2xx
 *
 * The address is checked like every user-given address (public-url-guard.ts:
 * https, a public host, no port, every DNS answer public). A redirect is
 * refused, not followed, so the signed body never goes anywhere else. The
 * answer is read up to 8 KB. Pure apart from the injected fetch and resolver.
 */

import { checkPublicUrl, resolvesPublic, type DnsResolver } from './public-url-guard.ts'

export const TEST_ACCOUNT_HOOK_TIMEOUT_MS = 8_000
export const TEST_ACCOUNT_HOOK_MAX_BYTES = 8 * 1024
export const TEST_ACCOUNT_HOOK_USER_AGENT = 'MushiTestAccounts/1'
/** Accounts one project's hook is asked for an hour (the same number the internal mint allows one operator). */
export const HOOK_ACCOUNTS_PER_HOUR = 12
export const HOOK_ACCOUNT_RATE_SCOPE = 'fresh_eyes_hook_account'
/** A hook account lives this long; Mushi asks the hook to delete it when the run ends. */
export const HOOK_ACCOUNT_TTL_HOURS = 24

export type HookEvent = 'mushi.test_account.create' | 'mushi.test_account.expire'

export interface HookAccount {
  email: string
  password: string
  name?: string
  /** The app's own id for the account, when the hook gives one (sent back on expire). */
  id?: string
}

const CONTROL = /[\u0000-\u001f\u007f]/
const EMAIL_RE = /^[^\s@]{1,100}@[^\s@]{1,200}$/
const ID_RE = /^[A-Za-z0-9_.:@+-]{1,128}$/

/** The hook's address, checked for shape (DNS is checked at call time). */
export function hookUrl(raw: unknown): { ok: true; url: string } | { ok: false; message: string } {
  if (typeof raw !== 'string' || raw.length > 500) return { ok: false, message: 'The hook address is an https:// address of at most 500 characters.' }
  const checked = checkPublicUrl(raw)
  if (!checked.ok) return { ok: false, message: checked.message }
  if (checked.url.protocol !== 'https:') return { ok: false, message: 'The hook address must start with https://.' }
  return { ok: true, url: checked.url.toString() }
}

/** A new signing secret, shown once. */
export function newHookSecret(random: Uint8Array): string {
  if (random.length < 24) throw new Error('need at least 24 random bytes')
  return `mtah_${[...random].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** `t=<unix seconds>,v1=<hex>`: the signature over "<t>.<body>", so an old delivery cannot be replayed with a new time. */
export async function signHookBody(secret: string, body: string, now: Date): Promise<string> {
  const t = Math.floor(now.getTime() / 1000)
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`
}

/** The account a create answer holds, or why it is not one. */
export function parseHookAccount(raw: unknown): { ok: true; account: HookAccount } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'The hook did not answer with a JSON object.' }
  const r = raw as Record<string, unknown>
  if (typeof r.email !== 'string' || !EMAIL_RE.test(r.email.trim())) return { ok: false, message: 'The hook answered without a valid email.' }
  if (typeof r.password !== 'string' || r.password.length < 12 || r.password.length > 200 || CONTROL.test(r.password)) {
    return { ok: false, message: 'The hook answered without a password of 12 to 200 characters.' }
  }
  const account: HookAccount = { email: r.email.trim(), password: r.password }
  if (typeof r.name === 'string' && r.name.trim() && r.name.length <= 80 && !CONTROL.test(r.name)) account.name = r.name.trim()
  if (r.id != null) {
    const id = String(r.id)
    if (!ID_RE.test(id)) return { ok: false, message: 'The hook answered with an id Mushi cannot send back (letters, digits and _.:@+- only, up to 128).' }
    account.id = id
  }
  return { ok: true, account }
}

export interface HookDeps {
  fetchImpl?: typeof fetch
  resolver?: DnsResolver | null
  now?: Date
}

export type HookCallResult = { ok: true; status: number; body: unknown } | { ok: false; message: string }

async function readCapped(res: Response): Promise<string | null> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > TEST_ACCOUNT_HOOK_MAX_BYTES) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

/** One signed POST to the hook. Never follows a redirect; never throws. */
export async function callHook(url: string, secret: string, event: HookEvent, payload: Record<string, unknown>, deps: HookDeps = {}): Promise<HookCallResult> {
  const checked = hookUrl(url)
  if (!checked.ok) return { ok: false, message: checked.message }
  const host = new URL(checked.url).hostname
  if (!(await resolvesPublic(host, deps.resolver ?? null))) return { ok: false, message: 'The hook address resolves to a private address, so Mushi did not call it.' }
  const body = JSON.stringify({ event, ...payload })
  const signature = await signHookBody(secret, body, deps.now ?? new Date())
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEST_ACCOUNT_HOOK_TIMEOUT_MS)
  try {
    const res = await (deps.fetchImpl ?? fetch)(checked.url, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': TEST_ACCOUNT_HOOK_USER_AGENT,
        'X-Mushi-Event': event,
        'X-Mushi-Signature': signature,
        'X-Mushi-Delivery': crypto.randomUUID(),
      },
      body,
    })
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {})
      return { ok: false, message: `The hook answered with a redirect (${res.status}); Mushi does not follow it. Give the final address.` }
    }
    const text = await readCapped(res)
    if (text === null) return { ok: false, message: 'The hook answered with more than 8 KB.' }
    if (res.status < 200 || res.status >= 300) return { ok: false, message: `The hook answered ${res.status}.` }
    let parsed: unknown = null
    if (text.trim()) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }
    return { ok: true, status: res.status, body: parsed }
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === 'AbortError'
    return { ok: false, message: aborted ? `The hook did not answer within ${TEST_ACCOUNT_HOOK_TIMEOUT_MS / 1000} s.` : 'The hook could not be reached.' }
  } finally {
    clearTimeout(timer)
  }
}

/** Ask the hook for one visitor's account. */
export async function requestHookAccount(
  url: string,
  secret: string,
  input: { projectId: string; runId: string; visitor: number; expiresAt: string; persona: { name: string; locale: string } | null },
  deps: HookDeps = {},
): Promise<{ ok: true; account: HookAccount } | { ok: false; message: string }> {
  const r = await callHook(url, secret, 'mushi.test_account.create', { project_id: input.projectId, run_id: input.runId, visitor: input.visitor, expires_at: input.expiresAt, persona: input.persona }, deps)
  if (!r.ok) return r
  return parseHookAccount(r.body)
}

/** Ask the hook to delete a run's accounts (best effort; the hook deletes them by expires_at anyway). */
export async function expireHookAccounts(url: string, secret: string, input: { projectId: string; runId: string; accounts: readonly string[] }, deps: HookDeps = {}): Promise<HookCallResult> {
  return callHook(url, secret, 'mushi.test_account.expire', { project_id: input.projectId, run_id: input.runId, accounts: [...input.accounts].slice(0, 10) }, deps)
}

/** What a run row keeps of its hook accounts: the hook's id, else the email; never a password. */
export function accountRefs(accounts: readonly HookAccount[]): string[] {
  return accounts.map((a) => a.id ?? a.email).slice(0, 10)
}
