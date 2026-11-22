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
    `Mushi Mushi's "${check}" check found a problem${where}: ${f.message.trim()}${/[.!?]$/.test(f.message.trim()) ? '' : '.'}${rule}`,
    about ? `What this check looks for: ${about}` : null,
    'Find the cause and fix it with the smallest change that makes the check pass. Keep the existing behaviour, then run the tests.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Every open finding of one check as one prompt (Full-stack
 * audit "Fix all in this check", 2026-11-19): the check, each finding with its place, then the rule.
 */
export function checkFindingsFixPrompt(findings: readonly PromptFinding[]): string {
  const gate = findings[0]?.gate
  const check = gate ? gateLabel(gate) : 'An automatic check'
  const about = gate ? gateInfo(gate)?.checks : undefined
  const lines = findings.map((f) => {
    const where = f.file_path ? ` (${f.file_path}${f.line != null ? `:${f.line}` : ''})` : ''
    const rule = f.rule_id ? ` [${ruleLabel(f.rule_id)}]` : ''
    return `- ${f.message.trim()}${where}${rule}`
  })
  return [
    `Mushi Mushi's "${check}" check found ${findings.length} problem${findings.length === 1 ? '' : 's'}:`,
    lines.join('\n'),
    about ? `What this check looks for: ${about}` : null,
    'Fix each one with the smallest change that makes the check pass. Keep the existing behaviour, then run the tests.',
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
  return <CopyPromptButton text={findingFixPrompt(finding)} variant={variant} label={label} testId="copy-fix-prompt" />
}

/**
 * A button that copies any prepared prompt for the editor and says "Copied" for a moment
 * (App blueprint "Fix all", Design system per-file prompts, 2026-11-19).
 */
export function CopyPromptButton({
  text,
  variant = 'ghost',
  label = 'Copy fix prompt',
  title,
  testId = 'copy-prompt',
}: {
  text: string
  variant?: 'ghost' | 'primary'
  label?: string
  title?: string
  testId?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard writes fail on http:// or when permission is denied; the label stays put.
    }
  }
  return (
    <Btn size="sm" variant={variant} onClick={() => void copy()} title={title} data-testid={testId}>
      {copied ? 'Copied' : label}
    </Btn>
  )
}
