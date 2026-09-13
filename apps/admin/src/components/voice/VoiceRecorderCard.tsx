/**
 * FILE: apps/admin/src/components/voice/VoiceRecorderCard.tsx
 * PURPOSE: Capture surface for the Voice page — tap-to-talk (MediaRecorder,
 *          120 s cap, level meter), an "Upload a clip" fallback, and a typed
 *          transcript fallback for devices without a microphone. Emits the
 *          File (or text) upward; the page owns upload + intake.
 */

import { useRef, useState, type ChangeEvent } from 'react'
import { Btn, Section, Textarea } from '../ui'
import { InlineProof, SignalChip } from '../report-detail/ReportSurface'
import { IconMic } from '../icons'
import { useVoiceRecorder } from './useVoiceRecorder'
import {
  MAX_RECORDING_MS,
  UPLOAD_ACCEPT,
  formatBytes,
  formatDuration,
  isAcceptableAudioFile,
} from '../../lib/voiceRecorder'

export type SubmitStage = 'signing' | 'uploading' | 'transcribing'

const STAGE_LABEL: Record<SubmitStage, string> = {
  signing: 'Preparing upload…',
  uploading: 'Uploading clip…',
  transcribing: 'Transcribing…',
}

interface VoiceRecorderCardProps {
  onFile: (file: File) => void
  onTranscript: (text: string) => void
  /** Non-null while the page is uploading / transcribing a clip. */
  busyStage: SubmitStage | null
  /** Voice intake is off for this project — capture stays visible but inert. */
  disabled?: boolean
  /** Pre-filled text from a share_target text/title share. */
  initialText?: string
  /** File handed over by the share target; shown as "ready to send". */
  pendingFile?: File | null
}

export function VoiceRecorderCard({ onFile, onTranscript, busyStage, disabled, initialText, pendingFile }: VoiceRecorderCardProps) {
  const [fileError, setFileError] = useState<string | null>(null)
  const [text, setText] = useState(initialText ?? '')
  const [showTyped, setShowTyped] = useState(Boolean(initialText))
  const inputRef = useRef<HTMLInputElement | null>(null)

  const recorder = useVoiceRecorder((file) => {
    setFileError(null)
    onFile(file)
  })

  const busy = busyStage !== null
  const recording = recorder.state === 'recording'
  const remainingMs = Math.max(0, MAX_RECORDING_MS - recorder.elapsedMs)

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const verdict = isAcceptableAudioFile(file)
    if (!verdict.ok) {
      setFileError(verdict.reason)
      return
    }
    setFileError(null)
    onFile(file)
  }

  function submitTyped() {
    const trimmed = text.trim()
    if (!trimmed) return
    onTranscript(trimmed)
    setText('')
  }

  const micTitle = disabled
    ? 'Turn on voice intake in Settings first'
    : !recorder.supported
      ? 'This browser cannot record — upload a clip instead'
      : busy
        ? 'Wait for the current clip to finish'
        : recording
          ? 'Stop and send'
          : 'Start recording'

  return (
    <Section title="Talk" icon={<IconMic className="h-4 w-4" />}>
      <div className="flex flex-col items-center gap-3 py-2">
        <Btn
          variant={recording ? 'danger' : 'primary'}
          size="md"
          onClick={() => (recording ? recorder.stop() : void recorder.start())}
          disabled={disabled || busy || !recorder.supported || recorder.state === 'requesting' || recorder.state === 'stopping'}
          loading={recorder.state === 'requesting' || recorder.state === 'stopping' || busy}
          title={micTitle}
          aria-label={micTitle}
          aria-pressed={recording}
          className="min-w-44 py-3 text-base"
          leadingIcon={<IconMic className="h-4 w-4" />}
          data-testid="voice-record-toggle"
        >
          {busy ? STAGE_LABEL[busyStage] : recording ? `Stop · ${formatDuration(recorder.elapsedMs)}` : 'Tap to talk'}
        </Btn>

        {recording && (
          <div className="w-full max-w-sm space-y-1" aria-live="polite">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(recorder.level * 100)}>
              <div
                className="h-full rounded-full bg-brand motion-safe:transition-[width] motion-safe:duration-75"
                style={{ width: `${Math.round(recorder.level * 100)}%` }}
              />
            </div>
            <p className="text-center text-2xs text-fg-muted">
              Auto-stops in {formatDuration(remainingMs)} · {recorder.mimeType?.split(';')[0] ?? 'audio'}
            </p>
          </div>
        )}

        {!recording && !busy && (
          <p className="text-center text-xs text-fg-muted">
            Say what broke or what to change. You will see the exact transcript before anything is dispatched.
          </p>
        )}

        {recorder.error && <SignalChip tone="danger">{recorder.error}</SignalChip>}
        {fileError && <SignalChip tone="danger">{fileError}</SignalChip>}
        {pendingFile && !busy && (
          <InlineProof>
            Shared: {pendingFile.name} · {formatBytes(pendingFile.size)}
          </InlineProof>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 border-t border-edge-subtle pt-3">
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="sr-only"
          onChange={pickFile}
          aria-label="Upload an audio clip"
          data-testid="voice-upload-input"
        />
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          title={disabled ? 'Turn on voice intake in Settings first' : 'Send a voice memo (m4a, ogg, mp3, wav, webm)'}
        >
          Upload a clip
        </Btn>
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => setShowTyped((v) => !v)}
          disabled={disabled || busy}
          title={disabled ? 'Turn on voice intake in Settings first' : 'No microphone? Type the request instead'}
          aria-expanded={showTyped}
        >
          {showTyped ? 'Hide typed request' : 'Type it instead'}
        </Btn>
      </div>

      {showTyped && (
        <div className="mt-3 space-y-2">
          <Textarea
            label="Typed request"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="e.g. The login button does nothing on Safari — open a draft PR"
            disabled={disabled || busy}
            maxLength={2000}
          />
          <div className="flex justify-end">
            <Btn
              variant="accent"
              size="sm"
              onClick={submitTyped}
              disabled={disabled || busy || text.trim().length === 0}
              title={text.trim().length === 0 ? 'Type a request first' : 'Send the typed request'}
            >
              Send text
            </Btn>
          </div>
        </div>
      )}
    </Section>
  )
}
