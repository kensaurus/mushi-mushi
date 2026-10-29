// SPDX-License-Identifier: MIT
/**
 * `mushi-ux fresh-eyes --request-stdin`: a first-time user test the console
 * queued and a local worker runs (`mushi work --daemon`, ADR 0053 amendment
 * 2026-10-28). The worker passes the request as one JSON document on stdin,
 * never in argv (where `ps` and a shell could read it) or the environment: it
 * can hold test-account passwords. This parser checks it again, whatever the
 * worker checked.
 */

import type { Identity } from './fresh-eyes.js'

export interface FreshEyesStdinRequest {
  /** The console's run id: the run syncs into the row the console made. */
  runId: string
  url: string
  goal: string
  sessions: number
  /** Plain words that mean the visitor made it (matched as written, not as a pattern), or null. */
  successText: string | null
  dryRun: boolean
  accounts: Identity[]
}

const RUN_ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/
/** A request is a few hundred bytes; anything this big is not one. */
const MAX_BYTES = 64 * 1024

function plain(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max || CONTROL_RE.test(raw)) return null
  return raw.trim()
}

/** Throws with a plain message on anything that is not a request. */
export function parseStdinRequest(text: string): FreshEyesStdinRequest {
  if (text.length > MAX_BYTES) throw new Error('The request on stdin is too large.')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('The request on stdin is not JSON.')
  }
  const r = (raw ?? {}) as Record<string, unknown>
  if (typeof r.runId !== 'string' || !RUN_ID_RE.test(r.runId)) throw new Error('The request has no run id.')
  let url: URL
  try {
    url = new URL(String(r.url))
  } catch {
    throw new Error('The request has no start page.')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) throw new Error('The start page must be an http(s) address.')
  const goal = plain(r.goal, 300)
  if (!goal) throw new Error('The request has no goal.')
  if (typeof r.sessions !== 'number' || !Number.isInteger(r.sessions) || r.sessions < 1 || r.sessions > 5) throw new Error('Visitors must be 1 to 5.')
  const successText = r.successText == null ? null : plain(r.successText, 120)
  if (r.successText != null && !successText) throw new Error('The success words must be plain text.')
  if (typeof r.dryRun !== 'boolean') throw new Error('dryRun must be true or false.')
  const accounts: Identity[] = []
  for (const a of Array.isArray(r.accounts) ? (r.accounts as Array<Record<string, unknown>>) : []) {
    const email = plain(a?.email, 300)
    if (!email || !/^[^\s@]+@[^\s@]+$/.test(email) || typeof a.password !== 'string' || a.password.length < 12 || CONTROL_RE.test(a.password)) throw new Error('A test account in the request is malformed.')
    const userId = typeof a.userId === 'string' && /^[0-9a-f-]{36}$/i.test(a.userId) ? a.userId : undefined
    accounts.push({ email, password: a.password, name: plain(a.name, 80) ?? undefined, ...(userId ? { userId } : {}) })
  }
  if (r.dryRun && accounts.length) throw new Error('A look-around run uses no account.')
  return { runId: r.runId, url: url.toString(), goal, sessions: r.sessions, successText, dryRun: r.dryRun, accounts }
}

/**
 * Whether the run goes to the console: with --sync or --file and a login. A
 * dry run syncs too (the console queued it and waits for it; it shows as
 * "look around only"); it only files nothing.
 */
export function syncsToConsole(flags: { sync?: boolean; file?: boolean }, hasLogin: boolean): boolean {
  return !!(flags.sync || flags.file) && hasLogin
}

/**
 * Steps per visitor: what --steps says, else 30, or 60 with an account. Signing
 * in, naming a project and the CLI step did not fit in 30 on Mushi's first live
 * run with accounts (it ran out on "Name your project", 2026-10-28).
 */
export function stepsFor(given: string | undefined, hasAccount: boolean): number {
  if (given !== undefined && given.trim() !== '') return Number(given)
  return hasAccount ? 60 : 30
}

/** A phrase as a case-insensitive pattern that matches exactly those words (the goal check takes a pattern). */
export function literalPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** stdin, whole, up to the size cap. */
export async function readStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += b.length
    if (size > MAX_BYTES) throw new Error('The request on stdin is too large.')
    chunks.push(b)
  }
  return Buffer.concat(chunks).toString('utf8')
}
