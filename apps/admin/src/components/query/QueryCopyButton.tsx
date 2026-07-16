import { useState } from 'react'
import { IconCheck, IconCopy } from '../icons'
import { useToast } from '../../lib/toast'

export function QueryCopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true)
            toast.success('Copied to clipboard')
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => toast.error('Could not copy'))
      }}
      className="inline-flex items-center gap-1 text-2xs text-fg-faint hover:text-fg motion-safe:transition-opacity px-1.5 py-0.5 rounded-sm hover:bg-surface-overlay/50"
      aria-label={label}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  )
}
