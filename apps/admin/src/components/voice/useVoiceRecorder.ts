/**
 * FILE: apps/admin/src/components/voice/useVoiceRecorder.ts
 * PURPOSE: Tap-to-talk hook over MediaRecorder for the Voice page. Probes the
 *          best container (Opus/WebM → MP4/AAC on Safari), enforces the 120 s
 *          cap, exposes an RMS level for the meter, and hands the finished
 *          clip back as a File. Web Speech is deliberately not used — the
 *          audio is transcribed server-side (plan C2).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_RECORDING_MS, pickRecorderMimeType, recordingFileName } from '../../lib/voiceRecorder'

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopping'

export interface VoiceRecorder {
  state: RecorderState
  /** True when MediaRecorder + getUserMedia exist in this browser. */
  supported: boolean
  mimeType: string | null
  elapsedMs: number
  /** 0..1 microphone level, updated ~20×/s while recording. */
  level: number
  error: string | null
  start: () => Promise<void>
  stop: () => void
}

const LEVEL_INTERVAL_MS = 50
const TICK_MS = 250

export function useVoiceRecorder(onRecorded: (file: File, durationMs: number) => void): VoiceRecorder {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const supported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)

  const mimeType = supported ? pickRecorderMimeType((m) => MediaRecorder.isTypeSupported(m)) : null

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const tickRef = useRef<number | null>(null)
  const capRef = useRef<number | null>(null)
  const levelRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const onRecordedRef = useRef(onRecorded)
  onRecordedRef.current = onRecorded

  const cleanup = useCallback(() => {
    if (tickRef.current) window.clearInterval(tickRef.current)
    if (capRef.current) window.clearTimeout(capRef.current)
    if (levelRef.current) window.clearInterval(levelRef.current)
    tickRef.current = capRef.current = levelRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void audioCtxRef.current?.close().catch(() => undefined)
    audioCtxRef.current = null
    recorderRef.current = null
    setLevel(0)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const stop = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    setState('stopping')
    try {
      rec.stop()
    } catch {
      cleanup()
      setState('idle')
    }
  }, [cleanup])

  const start = useCallback(async () => {
    if (!supported) {
      setError('This browser cannot record audio. Use "Upload a clip" instead.')
      return
    }
    if (recorderRef.current) return
    setError(null)
    setState('requesting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setState('idle')
      const name = err instanceof Error ? err.name : ''
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access was blocked. Allow it in the browser settings, or upload a clip instead.'
          : name === 'NotFoundError'
            ? 'No microphone found on this device.'
            : `Could not open the microphone (${err instanceof Error ? err.message : String(err)}).`,
      )
      return
    }
    streamRef.current = stream

    let rec: MediaRecorder
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch (err) {
      cleanup()
      setState('idle')
      setError(`Recorder unavailable (${err instanceof Error ? err.message : String(err)}).`)
      return
    }
    recorderRef.current = rec
    chunksRef.current = []

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onerror = () => {
      setError('Recording failed part-way. Try again.')
      cleanup()
      setState('idle')
    }
    rec.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current
      const type = rec.mimeType || mimeType || 'application/octet-stream'
      const blob = new Blob(chunksRef.current, { type })
      chunksRef.current = []
      cleanup()
      setState('idle')
      setElapsedMs(0)
      if (blob.size === 0) {
        setError('Nothing was recorded — the clip was empty.')
        return
      }
      onRecordedRef.current(new File([blob], recordingFileName(type), { type }), durationMs)
    }

    // Level meter — optional; a missing AudioContext just leaves the bar flat.
    try {
      const Ctx = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctx) {
        const ctx = new Ctx()
        audioCtxRef.current = ctx
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)
        const buf = new Uint8Array(analyser.fftSize)
        levelRef.current = window.setInterval(() => {
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / buf.length)
          setLevel(Math.min(1, rms * 3))
        }, LEVEL_INTERVAL_MS)
      }
    } catch {
      // meter is cosmetic
    }

    startedAtRef.current = Date.now()
    setElapsedMs(0)
    rec.start(1000)
    setState('recording')
    tickRef.current = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), TICK_MS)
    capRef.current = window.setTimeout(() => stop(), MAX_RECORDING_MS)
  }, [supported, mimeType, cleanup, stop])

  return { state, supported, mimeType, elapsedMs, level, error, start, stop }
}
