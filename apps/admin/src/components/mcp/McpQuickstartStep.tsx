import { IconCheck } from '../icons'
import { CHIP_TONE } from '../../lib/chipTone'

export interface McpQuickstartStepProps {
  n: number
  title: string
  body: React.ReactNode
  tone: 'idle' | 'done' | 'next'
}

export function McpQuickstartStep({ n, title, body, tone }: McpQuickstartStepProps) {
  const badgeTone =
    tone === 'done'
      ? CHIP_TONE.okSubtle + ' border-ok/40'
      : tone === 'next'
        ? 'bg-brand text-brand-fg border-brand'
        : 'bg-surface-overlay text-fg-muted border-edge-subtle'
  return (
    <div className="flex gap-3 items-start">
      <span
        className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-semibold ${badgeTone}`}
        aria-hidden="true"
      >
        {tone === 'done' ? <IconCheck className="h-3.5 w-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-fg">{title}</div>
        <div className="text-xs text-fg-muted mt-0.5">{body}</div>
      </div>
    </div>
  )
}
