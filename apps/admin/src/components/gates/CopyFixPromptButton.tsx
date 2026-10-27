/**
 * FILE: apps/admin/src/components/gates/CopyFixPromptButton.tsx
 * PURPOSE: "Copy fix prompt" on a check finding: the facts a coding agent
 *          needs (which check, what it found, file and line, the rule) as one
 *          paste for the editor. The audit page's primary way to act on a
 *          finding without leaving the editor.
 */

import { useState } from 'react'
import { Btn } from '../ui'
import { gateInfo, gateLabel, ruleLabel } from '../../lib/gateLabels'

interface PromptFinding {
  message: string
  gate?: string
  severity?: string | null
  file_path?: string | null
  line?: number | null
  rule_id?: string | null
}

/** @internal Exported for tests only. The prompt text: facts first, then what to do. */
export function findingFixPrompt(f: PromptFinding): string {
  const check = f.gate ? gateLabel(f.gate) : 'An automatic check'
  const where = f.file_path ? ` in ${f.file_path}${f.line != null ? ` (line ${f.line})` : ''}` : ''
  const rule = f.rule_id ? ` Rule: ${ruleLabel(f.rule_id)}.` : ''
  const about = f.gate ? gateInfo(f.gate)?.checks : undefined
  return [
    `Mushi's "${check}" check found a problem${where}: ${f.message.trim()}${/[.!?]$/.test(f.message.trim()) ? '' : '.'}${rule}`,
    about ? `What this check looks for: ${about}` : null,
    'Find the cause and fix it with the smallest change that makes the check pass. Keep the existing behaviour, then run the tests.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function CopyFixPromptButton({
  finding,
  variant = 'ghost',
  label = 'Copy fix prompt',
}: {
  finding: PromptFinding
  variant?: 'ghost' | 'primary'
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(findingFixPrompt(finding))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard writes fail on http:// or when permission is denied; the label stays put.
    }
  }
  return (
    <Btn size="sm" variant={variant} onClick={() => void copy()} data-testid="copy-fix-prompt">
      {copied ? 'Copied' : label}
    </Btn>
  )
}
