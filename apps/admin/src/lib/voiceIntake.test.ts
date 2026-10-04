/**
 * Voice intake client (suspected-bugs entries 5, 114 and 258): the upload-url call
 * carries the audio type the server requires, waiting requests past their
 * window read as expired, and intake is off unless turned on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMutate = vi.fn()
const apiFetch = vi.fn()
const uploadToSignedUrl = vi.fn()

vi.mock('./supabase', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  apiFetchMutate: (...args: unknown[]) => apiFetchMutate(...args),
  supabase: { storage: { from: () => ({ uploadToSignedUrl: (...args: unknown[]) => uploadToSignedUrl(...args) }) } },
}))

import {
  canConfirmVoiceSession,
  effectiveVoiceStatus,
  isVoiceIntakeEnabled,
  uploadAndSubmitVoice,
} from './voiceIntake'

beforeEach(() => {
  apiFetchMutate.mockReset()
  apiFetch.mockReset()
  uploadToSignedUrl.mockReset()
})

/** The mime the upload-url request asked for, or null when none was sent. */
async function mimeAskedFor(name: string, type: string): Promise<string | null> {
  apiFetchMutate.mockReset()
  apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'X', message: 'stop here' } })
  await uploadAndSubmitVoice(new File([new Uint8Array([1])], name, { type }))
  const call = apiFetchMutate.mock.calls[0]
  return call ? (JSON.parse(call[1].body) as { mime: string }).mime : null
}

describe('the audio type sent for upload', () => {
  it('maps every alias the server accepts to the canonical bucket type', async () => {
    expect(await mimeAskedFor('a', 'audio/webm;codecs=opus')).toBe('audio/webm')
    expect(await mimeAskedFor('a', 'audio/x-m4a')).toBe('audio/mp4')
    expect(await mimeAskedFor('a', 'audio/mp3')).toBe('audio/mpeg')
    expect(await mimeAskedFor('a', 'audio/x-wav')).toBe('audio/wav')
    expect(await mimeAskedFor('a', 'application/ogg')).toBe('audio/ogg')
  })

  it('falls back to the file extension when the browser gives no type or an alias the server refuses', async () => {
    expect(await mimeAskedFor('Recording 12.m4a', '')).toBe('audio/mp4')
    expect(await mimeAskedFor('memo.M4A', 'audio/mp4a-latm')).toBe('audio/mp4')
    expect(await mimeAskedFor('clip.opus', '')).toBe('audio/ogg')
  })

  it('sends nothing for formats the server cannot transcribe', async () => {
    expect(await mimeAskedFor('memo.caf', '')).toBeNull()
    expect(await mimeAskedFor('noext', 'video/mp4')).toBeNull()
  })
})

describe('uploadAndSubmitVoice', () => {
  it('asks for the upload URL with the mime the server requires and uploads under its type', async () => {
    apiFetchMutate.mockResolvedValue({
      ok: true,
      data: { bucket: 'voice-intake', path: 'p/x.m4a', signedUrl: 'https://s/u', token: 't', mime: 'audio/mp4' },
    })
    uploadToSignedUrl.mockResolvedValue({ error: null })
    apiFetch.mockResolvedValue({ ok: true, data: { session: { id: 's1', status: 'created' } } })

    const file = new File([new Uint8Array([1, 2, 3])], 'memo.m4a', { type: '' })
    const res = await uploadAndSubmitVoice(file)

    expect(res.ok).toBe(true)
    expect(apiFetchMutate).toHaveBeenCalledWith('/v1/intake/voice/upload-url', { body: JSON.stringify({ mime: 'audio/mp4' }) })
    expect(uploadToSignedUrl.mock.calls[0]?.[3]).toMatchObject({ contentType: 'audio/mp4' })
  })

  it('refuses an unreadable format in plain words without calling the server', async () => {
    const file = new File([new Uint8Array([1])], 'memo.caf', { type: '' })
    const res = await uploadAndSubmitVoice(file)
    expect(res).toEqual({ ok: false, message: expect.stringContaining('.m4a, .mp3, .ogg, .webm or .wav') })
    expect(apiFetchMutate).not.toHaveBeenCalled()
  })
})

describe('effectiveVoiceStatus / canConfirmVoiceSession', () => {
  const now = Date.parse('2026-10-04T10:00:00Z')

  it('reads a waiting request past its window as expired', () => {
    const s = { status: 'awaiting_confirm', expires_at: '2026-10-04T09:59:00+00:00', confirm_token: 'vc_x' }
    expect(effectiveVoiceStatus(s, now)).toBe('expired')
    expect(canConfirmVoiceSession(s, now)).toBe(false)
  })

  it('lets a waiting request with a token be confirmed', () => {
    const s = { status: 'awaiting_confirm', expires_at: '2026-10-04T10:05:00+00:00', confirm_token: 'vc_x' }
    expect(effectiveVoiceStatus(s, now)).toBe('awaiting_confirm')
    expect(canConfirmVoiceSession(s, now)).toBe(true)
    expect(canConfirmVoiceSession({ ...s, confirm_token: null }, now)).toBe(false)
  })

  it('leaves other statuses alone', () => {
    expect(effectiveVoiceStatus({ status: 'dispatched', expires_at: '2020-01-01T00:00:00Z' }, now)).toBe('dispatched')
  })
})

describe('isVoiceIntakeEnabled', () => {
  it('is off unless the project turned it on', () => {
    expect(isVoiceIntakeEnabled({})).toBe(false)
    expect(isVoiceIntakeEnabled(null)).toBe(false)
    expect(isVoiceIntakeEnabled({ voice_intake_enabled: false })).toBe(false)
    expect(isVoiceIntakeEnabled({ voice_intake_enabled: true })).toBe(true)
  })
})
