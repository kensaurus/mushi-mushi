/**
 * Pure helpers in lib/voiceRecorder.ts — MIME probing order (Opus/WebM before
 * Safari's MP4), file naming, the upload accept rules and formatting.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_RECORDING_MS,
  MAX_UPLOAD_BYTES,
  extensionForMime,
  formatBytes,
  formatDuration,
  isAcceptableAudioFile,
  pickRecorderMimeType,
  recordingFileName,
} from './voiceRecorder'

describe('pickRecorderMimeType', () => {
  it('prefers Opus in WebM when the engine supports it (Chrome, Firefox)', () => {
    expect(pickRecorderMimeType((m) => m.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
  })
  it('falls back to audio/mp4 on Safari', () => {
    expect(pickRecorderMimeType((m) => m === 'audio/mp4')).toBe('audio/mp4')
  })
  it('returns null when nothing is supported and survives throwing probes', () => {
    expect(pickRecorderMimeType(() => false)).toBeNull()
    expect(
      pickRecorderMimeType((m) => {
        if (m.includes('webm')) throw new Error('unsupported container')
        return m === 'audio/ogg'
      }),
    ).toBe('audio/ogg')
  })
})

describe('extensionForMime / recordingFileName', () => {
  it('maps containers to phone-friendly extensions', () => {
    expect(extensionForMime('audio/webm;codecs=opus')).toBe('webm')
    expect(extensionForMime('audio/mp4')).toBe('m4a')
    expect(extensionForMime('audio/x-m4a')).toBe('m4a')
    expect(extensionForMime('audio/ogg;codecs=opus')).toBe('ogg')
    expect(extensionForMime('audio/mpeg')).toBe('mp3')
    expect(extensionForMime('audio/wav')).toBe('wav')
    expect(extensionForMime(null)).toBe('bin')
  })
  it('names recordings with a sortable timestamp', () => {
    expect(recordingFileName('audio/webm;codecs=opus', new Date('2026-09-12T07:15:02.123Z'))).toBe('voice-2026-09-12T07-15-02.webm')
  })
})

describe('caps and accept rules', () => {
  it('keeps the 120 s recording cap from the plan', () => {
    expect(MAX_RECORDING_MS).toBe(120_000)
  })
  it('accepts audio by type or by extension and rejects empty / oversized / non-audio', () => {
    expect(isAcceptableAudioFile({ type: 'audio/mp4', name: 'memo', size: 1000 })).toEqual({ ok: true })
    expect(isAcceptableAudioFile({ type: '', name: 'Recorder clip.m4a', size: 1000 })).toEqual({ ok: true })
    expect(isAcceptableAudioFile({ type: 'video/webm', name: 'x', size: 1000 })).toEqual({ ok: true })
    expect(isAcceptableAudioFile({ type: 'audio/mp4', name: 'memo.m4a', size: 0 }).ok).toBe(false)
    expect(isAcceptableAudioFile({ type: 'audio/mp4', name: 'memo.m4a', size: MAX_UPLOAD_BYTES + 1 }).ok).toBe(false)
    expect(isAcceptableAudioFile({ type: 'image/png', name: 'shot.png', size: 1000 }).ok).toBe(false)
  })
})

describe('formatting', () => {
  it('formats durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_400)).toBe('1:05')
    expect(formatDuration(-5)).toBe('0:00')
  })
  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(90 * 1024)).toBe('90 KB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})
