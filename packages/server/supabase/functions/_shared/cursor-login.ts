/**
 * FILE: packages/server/supabase/functions/_shared/cursor-login.ts
 * PURPOSE: "Switch the Cursor account" on a local worker from the console
 *          (ADR 0048 amendment 2026-10-28). Pure rules, shared by the routes
 *          and the heartbeat:
 *
 *            - the machine's owner names the account the lanes may spend
 *              (`work_hosts.cursor_account`) and asks for a sign-in;
 *            - the next heartbeat answer carries `{ requestId }`; the machine
 *              waits for its runs, signs the Cursor CLI out, starts
 *              `cursor-agent login` and reports the approve link;
 *            - the owner opens the link in the console and approves; the
 *              machine checks which account it now is and reports
 *              signed_in, wrong_account, failed or expired.
 *
 *          No key or password ever leaves Mushi or reaches the machine: the
 *          person signs in on cursor.com. The approve link is stored only
 *          while it is the current step and is shown only to the machine's
 *          owner (GET …/cursor-login), never in /work/lanes, the badge, MCP,
 *          logs or audit rows.
 */

import { cleanLogLine, maskEmail } from './work-telemetry.ts'

/** States the machine reports. `requested` is the server's own, before the machine picks it up. */
export const CURSOR_LOGIN_REPORT_STATES = ['waiting_for_runs', 'link_ready', 'signed_in', 'wrong_account', 'failed', 'expired'] as const
export type CursorLoginReportState = (typeof CURSOR_LOGIN_REPORT_STATES)[number]
export type CursorLoginState = 'requested' | CursorLoginReportState

const FINAL: ReadonlySet<CursorLoginState> = new Set(['signed_in', 'wrong_account', 'failed', 'expired'])

/** A request the machine has not finished within this long is expired (offline, or nobody approved). */
export const CURSOR_LOGIN_OPEN_MS = 60 * 60_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** An e-mail address, as Cursor accounts are named. Deliberately plain: no quotes, no IP literals. */
const ACCOUNT_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/
/** Only Cursor's own sign-in page is ever stored or shown. */
const LOGIN_URL_RE = /^https:\/\/(?:www\.)?cursor\.com\/[A-Za-z0-9/._~%?&=:+-]{1,1500}$/

/** The account, normalized, or null when it is not an e-mail address (≤254 characters). */
export function parseCursorAccount(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  return s.length <= 254 && ACCOUNT_RE.test(s) ? s : null
}

export interface CursorLoginReport {
  requestId: string
  state: CursorLoginReportState
  url: string | null
  detail: string | null
}

/** What the machine says about the sign-in it runs (heartbeat `status.cursorLogin`); null when malformed. */
export function parseCursorLoginReport(raw: unknown): CursorLoginReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.requestId !== 'string' || !UUID_RE.test(r.requestId)) return null
  if (typeof r.state !== 'string' || !(CURSOR_LOGIN_REPORT_STATES as readonly string[]).includes(r.state)) return null
  const state = r.state as CursorLoginReportState
  const url = state === 'link_ready' && typeof r.url === 'string' && LOGIN_URL_RE.test(r.url) ? r.url : null
  // A link_ready without a usable link is not a step the person can take.
  if (state === 'link_ready' && !url) return null
  return { requestId: r.requestId.toLowerCase(), state, url, detail: cleanLogLine(r.detail) }
}

/** `work_hosts.cursor_login`. */
export interface StoredCursorLogin {
  requestId: string
  state: CursorLoginState
  account: string
  requestedAt: string
  at: string
  url?: string | null
  detail?: string | null
}

export function parseStoredCursorLogin(raw: unknown): StoredCursorLogin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.requestId !== 'string' || typeof r.state !== 'string' || typeof r.account !== 'string' || typeof r.requestedAt !== 'string') return null
  return {
    requestId: r.requestId,
    state: r.state as CursorLoginState,
    account: r.account,
    requestedAt: r.requestedAt,
    at: typeof r.at === 'string' ? r.at : r.requestedAt,
    url: typeof r.url === 'string' ? r.url : null,
    detail: typeof r.detail === 'string' ? r.detail : null,
  }
}

export function isFinal(state: CursorLoginState): boolean {
  return FINAL.has(state)
}

/** A new request; the machine picks it up at its next heartbeat. */
export function newCursorLogin(requestId: string, account: string, now: Date): StoredCursorLogin {
  const at = now.toISOString()
  return { requestId, state: 'requested', account, requestedAt: at, at, url: null, detail: null }
}

/**
 * The request as it stands now: an unfinished one older than an hour reads as
 * expired (the machine was offline, or nobody approved the link).
 */
export function currentCursorLogin(stored: StoredCursorLogin | null, now: Date): StoredCursorLogin | null {
  if (!stored) return null
  if (isFinal(stored.state)) return stored
  if (now.getTime() - Date.parse(stored.requestedAt) > CURSOR_LOGIN_OPEN_MS) {
    return { ...stored, state: 'expired', url: null, detail: stored.state === 'requested' ? 'The machine did not pick up the request within an hour. It may be offline.' : 'The sign-in was not finished within an hour.', at: now.toISOString() }
  }
  return stored
}

/**
 * Fold the machine's report into the stored request. A report about another
 * request, or after the request ended, changes nothing. The link is kept only
 * while it is the step to take.
 */
export function mergeCursorLoginReport(stored: StoredCursorLogin | null, report: CursorLoginReport | null, now: Date): StoredCursorLogin | null {
  const cur = currentCursorLogin(stored, now)
  if (!cur || !report || report.requestId !== cur.requestId.toLowerCase() || isFinal(cur.state)) return cur
  return { ...cur, state: report.state, url: report.state === 'link_ready' ? report.url : null, detail: report.detail, at: now.toISOString() }
}

/** The heartbeat answer's `cursorLogin`: only while the request is open. */
export function pendingCursorLogin(stored: StoredCursorLogin | null, now: Date): { requestId: string } | null {
  const cur = currentCursorLogin(stored, now)
  return cur && !isFinal(cur.state) ? { requestId: cur.requestId } : null
}

export interface CursorLoginView {
  requestId: string
  state: CursorLoginState
  /** The account asked for: in full for the machine's owner, masked for everyone else. */
  account: string
  requestedAt: string
  at: string
  detail: string | null
  /** Only for the machine's owner, and only while the link is the step to take. */
  url?: string
}

export function cursorLoginView(stored: StoredCursorLogin | null, now: Date, opts: { owner: boolean; withUrl: boolean }): CursorLoginView | null {
  const cur = currentCursorLogin(stored, now)
  if (!cur) return null
  const view: CursorLoginView = {
    requestId: cur.requestId,
    state: cur.state,
    account: opts.owner ? cur.account : maskEmail(cur.account),
    requestedAt: cur.requestedAt,
    at: cur.at,
    detail: cur.detail ?? null,
  }
  if (opts.owner && opts.withUrl && cur.state === 'link_ready' && cur.url) view.url = cur.url
  return view
}
