/**
 * FILE: cursor-login.test.ts
 * PURPOSE: The rules behind "Switch account" (_shared/cursor-login.ts): an
 *          account must be an e-mail address; a machine's report counts only
 *          for the open request and only with Cursor's own sign-in link; the
 *          link lives only while it is the step and only the owner sees it;
 *          an unfinished request expires after an hour.
 */

import { describe, expect, it } from 'vitest'
import {
  CURSOR_LOGIN_OPEN_MS,
  cursorLoginView,
  mergeCursorLoginReport,
  newCursorLogin,
  parseCursorAccount,
  parseCursorLoginReport,
  pendingCursorLogin,
} from '../../supabase/functions/_shared/cursor-login.ts'
import { cleanLogLine } from '../../supabase/functions/_shared/work-telemetry.ts'

const RID = '5000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-28T12:00:00Z')
const LINK = 'https://cursor.com/loginDeepControl?challenge=abcDEF123_-xyz&uuid=1f95da85-6fc6-4e9c-8795-0ef1b7913f90&mode=login&redirectTarget=cli'

describe('cursor-login rules', () => {
  it('takes only an e-mail address as the account, lowercased', () => {
    expect(parseCursorAccount(' Kensaurus@Gmail.com ')).toBe('kensaurus@gmail.com')
    for (const bad of ['', 'kensaurus', 'a b@c.com', 'x@y', `${'x'.repeat(250)}@g.com`, null, 7]) expect(parseCursorAccount(bad)).toBeNull()
  })

  it('reads a report only with a request id, a known state, and Cursor\'s own link on link_ready', () => {
    expect(parseCursorLoginReport({ requestId: RID, state: 'link_ready', url: LINK })).toMatchObject({ state: 'link_ready', url: LINK })
    expect(parseCursorLoginReport({ requestId: RID, state: 'link_ready', url: 'https://evil.example/login' })).toBeNull()
    expect(parseCursorLoginReport({ requestId: RID, state: 'link_ready' })).toBeNull()
    expect(parseCursorLoginReport({ requestId: 'x', state: 'signed_in' })).toBeNull()
    expect(parseCursorLoginReport({ requestId: RID, state: 'hacked' })).toBeNull()
    // A link on any other state is dropped.
    expect(parseCursorLoginReport({ requestId: RID, state: 'signed_in', url: LINK })!.url).toBeNull()
    // Details are cleaned like every log line: no link, e-mails masked.
    expect(parseCursorLoginReport({ requestId: RID, state: 'failed', detail: `go to ${LINK} as kensaurus@gmail.com` })!.detail).toBe('go to [sign-in link hidden] as k***@g***.com')
  })

  it('folds in the open request\'s report only, and keeps the link only while it is the step', () => {
    const stored = newCursorLogin(RID, 'kensaurus@gmail.com', NOW)
    const linked = mergeCursorLoginReport(stored, parseCursorLoginReport({ requestId: RID, state: 'link_ready', url: LINK }), NOW)!
    expect(linked).toMatchObject({ state: 'link_ready', url: LINK })
    const other = mergeCursorLoginReport(linked, parseCursorLoginReport({ requestId: '5000000b-0000-4000-8000-000000000000', state: 'signed_in' }), NOW)!
    expect(other.state).toBe('link_ready')
    const done = mergeCursorLoginReport(linked, parseCursorLoginReport({ requestId: RID, state: 'signed_in' }), NOW)!
    expect(done).toMatchObject({ state: 'signed_in', url: null })
    // A finished request ignores later reports.
    expect(mergeCursorLoginReport(done, parseCursorLoginReport({ requestId: RID, state: 'link_ready', url: LINK }), NOW)!.state).toBe('signed_in')
  })

  it('shows the link to the owner alone, and masks the account for everyone else', () => {
    const linked = { ...newCursorLogin(RID, 'kensaurus@gmail.com', NOW), state: 'link_ready' as const, url: LINK }
    expect(cursorLoginView(linked, NOW, { owner: true, withUrl: true })!.url).toBe(LINK)
    expect(cursorLoginView(linked, NOW, { owner: true, withUrl: false })!.url).toBeUndefined()
    const member = cursorLoginView(linked, NOW, { owner: false, withUrl: true })!
    expect(member.url).toBeUndefined()
    expect(member.account).toBe('k***@g***.com')
  })

  it('an unfinished request expires after an hour and stops being sent to the machine', () => {
    const stored = newCursorLogin(RID, 'kensaurus@gmail.com', NOW)
    expect(pendingCursorLogin(stored, NOW)).toEqual({ requestId: RID })
    const later = new Date(NOW.getTime() + CURSOR_LOGIN_OPEN_MS + 1)
    expect(pendingCursorLogin(stored, later)).toBeNull()
    expect(cursorLoginView(stored, later, { owner: true, withUrl: true })).toMatchObject({ state: 'expired' })
  })

  it('every log line loses a Cursor sign-in link', () => {
    expect(cleanLogLine(`Open a browser and navigate to this link: ${LINK}`)).toBe('Open a browser and navigate to this link: [sign-in link hidden]')
  })
})
