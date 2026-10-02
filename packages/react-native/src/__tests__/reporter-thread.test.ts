/**
 * FILE: packages/react-native/src/__tests__/reporter-thread.test.ts
 * PURPOSE: The RN thread can never stay on "loading": every load settles to
 * comments or null (Retry), and mark-read never throws. Plan 018 §2.3.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@mushi-mushi/core', () => ({
  mushiPalette: (mode: string) => ({
    paper: mode === 'dark' ? '#111111' : '#FAF7F0',
    paperRaised: mode === 'dark' ? '#1A1A1A' : '#FFFFFF',
    ink: mode === 'dark' ? '#F2EEE6' : '#1A1A1A',
    inkMuted: '#777777',
    inkFaint: '#AAAAAA',
    ruleStrong: '#CCCCCC',
    ok: '#1F6B3A',
    danger: '#C0392B',
  }),
  MUSHI_CONTROL_DISABLED: { light: '#E5E5E5', dark: '#333333' },
  MUSHI_RADIUS: { card: 12 },
}))

import { loadReporterThread, markReporterReportRead, settleWithin, THREAD_LOAD_TIMEOUT_MS } from '../reporter-thread'
import { contrastingText, resolveRNTheme } from '../theme'

const comment = { id: 1, author_kind: 'admin' as const, body: 'Which page?', created_at: '2026-10-02T00:00:00Z' }

afterEach(() => {
  vi.useRealTimers()
})

describe('loadReporterThread', () => {
  it('returns the comments when the load answers', async () => {
    await expect(loadReporterThread(async () => [comment], 'r1')).resolves.toEqual([comment])
  })

  it('returns null (Retry) when the API reports failure', async () => {
    await expect(loadReporterThread(async () => null, 'r1')).resolves.toBeNull()
  })

  it('returns null when the load rejects or throws synchronously', async () => {
    await expect(loadReporterThread(async () => { throw new Error('network') }, 'r1')).resolves.toBeNull()
    await expect(
      loadReporterThread(() => { throw new Error('sync') }, 'r1'),
    ).resolves.toBeNull()
  })

  it('settles to null when the request never answers', async () => {
    vi.useFakeTimers()
    const never = new Promise<never>(() => undefined)
    const result = loadReporterThread(() => never, 'r1')
    await vi.advanceTimersByTimeAsync(THREAD_LOAD_TIMEOUT_MS)
    await expect(result).resolves.toBeNull()
  })

  it('keeps a late answer from overriding the timeout', async () => {
    vi.useFakeTimers()
    let answer: (v: string) => void = () => undefined
    const slow = new Promise<string>((r) => { answer = r })
    const result = settleWithin(slow, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    answer('late')
    await expect(result).resolves.toBeNull()
  })
})

describe('markReporterReportRead', () => {
  it('marks only unread rows for that report', async () => {
    const markNotificationRead = vi.fn().mockResolvedValue({ ok: true })
    const client = {
      listNotifications: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          notifications: [
            { id: 'n1', read_at: null, payload: { reportId: 'r1' } },
            { id: 'n2', read_at: '2026-10-01T00:00:00Z', payload: { reportId: 'r1' } },
            { id: 'n3', read_at: null, payload: { reportId: 'r2' } },
            { id: 'n4', read_at: null, payload: null },
          ],
        },
      }),
      markNotificationRead,
    }
    await expect(markReporterReportRead(client as never, 'tok', 'r1')).resolves.toBe(1)
    expect(markNotificationRead).toHaveBeenCalledTimes(1)
    expect(markNotificationRead).toHaveBeenCalledWith('n1', 'tok')
  })

  it('never throws and reports 0 on failure', async () => {
    const failing = { listNotifications: vi.fn().mockRejectedValue(new Error('down')), markNotificationRead: vi.fn() }
    await expect(markReporterReportRead(failing as never, 'tok', 'r1')).resolves.toBe(0)
    const notOk = { listNotifications: vi.fn().mockResolvedValue({ ok: false }), markNotificationRead: vi.fn() }
    await expect(markReporterReportRead(notOk as never, 'tok', 'r1')).resolves.toBe(0)
  })
})

describe('resolveRNTheme', () => {
  it('defaults to a neutral ink accent, not neon', () => {
    const light = resolveRNTheme(false)
    expect(light.accent).toBe('#1A1A1A')
    expect(light.accent.toUpperCase()).not.toBe('#0FFF50')
  })

  it('applies host tokens and picks readable text for a custom accent', () => {
    const gold = resolveRNTheme(true, { accent: '#C9A227', fontFamily: 'Georgia', radius: 4 })
    expect(gold.accent).toBe('#C9A227')
    expect(gold.accentFg).toBe('#000000')
    expect(gold.fontFamily).toBe('Georgia')
    expect(gold.radius).toBe(4)
    expect(resolveRNTheme(false, { accent: '#1E3A8A' }).accentFg).toBe('#FFFFFF')
    expect(resolveRNTheme(false, { accent: '#C9A227', accentFg: '#111111' }).accentFg).toBe('#111111')
  })

  it('ignores empty overrides', () => {
    expect(resolveRNTheme(false, { accent: '', bg: undefined }).accent).toBe('#1A1A1A')
  })

  it('falls back when the accent is not a hex colour', () => {
    expect(contrastingText('rebeccapurple', '#FFF')).toBe('#FFF')
  })
})
