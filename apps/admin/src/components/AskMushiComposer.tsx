/**
 * FILE: apps/admin/src/components/AskMushiComposer.tsx
 * PURPOSE: Auto-growing chat composer for the Ask Mushi sidebar with two
 *          cmdk-anchored popovers:
 *
 *            • `/`  → static slash-command registry (askMushiCommands.ts)
 *            • `@`  → page-published `mentionables[]` + debounced server
 *                     search via /v1/admin/ask-mushi/mentions
 *
 *          The popover is a small `cmdk` Command with arrow-key + Enter
 *          selection. We deliberately don't try to do free-floating
 *          positioning at the caret (DOM caret-rect math is fragile in
 *          textareas across browsers); the popover sits anchored to the
 *          textarea's bottom edge instead, which is a clear, predictable
 *          target on a 320-wide drawer.
 */

import { Command } from 'cmdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import {
  detectComposerToken,
  filterSlashCommands,
  type ComposerToken,
  type SlashCommand,
} from '../lib/askMushiCommands'
import type { PageMentionable } from '../lib/pageContext'

export interface MentionResult {
  kind: string
  id: string
  label: string
  sublabel?: string
}

export interface AskMushiComposerProps {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  /** Called when the user picks a slash command. Lets the parent decide
   *  whether to swap the message wholesale, run a local action (`/clear`),
   *  or apply a model override before submitting. The second arg carries
   *  the textarea value with the slash token already removed — the parent
   *  must use this instead of its own `value` prop to compose the next
   *  message, because React state batching means `setInput(stripped)`
   *  hasn't propagated by the time this callback fires. */
  onSlashCommand: (cmd: SlashCommand, strippedInput: string) => void
  /** Disabled while a request is in flight. */
  disabled?: boolean
  /** Placeholder shown when empty. */
  placeholder?: string
  /** Page-contributed @-mention hints. */
  mentionables?: PageMentionable[]
}

const MAX_ROWS = 8

export function AskMushiComposer({
  value,
  onChange,
  onSubmit,
  onSlashCommand,
  disabled = false,
  placeholder,
  mentionables = [],
}: AskMushiComposerProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [popover, setPopover] = useState<ComposerToken | null>(null)
  const [mentionResults, setMentionResults] = useState<MentionResult[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)

  // Auto-grow: measure scrollHeight after each value change.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18
    const max = lineHeight * MAX_ROWS + 12
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`
  }, [value])

  const updatePopover = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    const next = detectComposerToken(ta.value, ta.selectionStart ?? ta.value.length)
    setPopover(next)
  }, [])

  // Server-side mention search — debounced 150ms.
  useEffect(() => {
    if (!popover || popover.kind !== 'mention') {
      setMentionResults([])
      setMentionLoading(false)
      return
    }
    const q = popover.query.trim()
    if (q.length === 0) {
      setMentionResults([])
      setMentionLoading(false)
      return
    }
    setMentionLoading(true)
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch<{ mentions: MentionResult[] }>(
          `/v1/admin/ask-mushi/mentions?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        )
        if (ctrl.signal.aborted) return
        if (res.ok && res.data?.mentions) setMentionResults(res.data.mentions)
        else setMentionResults([])
      } finally {
        if (!ctrl.signal.aborted) setMentionLoading(false)
      }
    }, 150)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [popover])

  // Close popover if focus leaves the wrap entirely (clicking outside).
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setPopover(null)
    }
    if (popover) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [popover])

  const slashItems = useMemo(() => {
    if (!popover || popover.kind !== 'slash') return [] as SlashCommand[]
    return filterSlashCommands(popover.query).slice(0, 8)
  }, [popover])

  const mentionItems = useMemo(() => {
    if (!popover || popover.kind !== 'mention') return [] as MentionResult[]
    const q = popover.query.toLowerCase()
    const local = mentionables
      .filter((m) => {
        if (q.length === 0) return true
        return (
          m.id.toLowerCase().includes(q) ||
          m.label.toLowerCase().includes(q) ||
          (m.sublabel ?? '').toLowerCase().includes(q)
        )
      })
      .slice(0, 4)
      .map((m) => ({ kind: m.kind, id: m.id, label: m.label, sublabel: m.sublabel }))
    // Server-fetched results follow page-local hints. Dedupe on `kind:id`.
    const seen = new Set(local.map((m) => `${m.kind}:${m.id}`))
    const remote = mentionResults.filter((m) => !seen.has(`${m.kind}:${m.id}`)).slice(0, 8)
    return [...local, ...remote]
  }, [popover, mentionables, mentionResults])

  const acceptSlash = useCallback(
    (cmd: SlashCommand) => {
      // If the user is typing literally e.g. `/tldr what is going on?`
      // we replace just the slash token, not the rest of the message.
      const ta = taRef.current
      if (!ta || !popover || popover.kind !== 'slash') {
        onSlashCommand(cmd, value)
        setPopover(null)
        return
      }
      const after = ta.value.slice(ta.selectionStart ?? ta.value.length)
      const beforeToken = ta.value.slice(0, popover.tokenStart)
      const stripped = (beforeToken + after).trimStart()
      onChange(stripped)
      setPopover(null)
      // Pass the stripped value explicitly — parent's `value` prop hasn't
      // updated yet (React batches the setState above), and reading from
      // the closure would include the still-unstripped slash token.
      onSlashCommand(cmd, stripped)
    },
    [popover, onChange, onSlashCommand, value],
  )

  const acceptMention = useCallback(
    (m: MentionResult) => {
      const ta = taRef.current
      if (!ta || !popover || popover.kind !== 'mention') return
      const beforeToken = ta.value.slice(0, popover.tokenStart)
      const after = ta.value.slice(ta.selectionStart ?? ta.value.length)
      // Serialise as `@kind:id` so the backend's resolver can find it.
      // Trailing space is convenient — keeps the user typing.
      const token = `@${m.kind}:${m.id} `
      const next = beforeToken + token + after
      onChange(next)
      setPopover(null)
      // Restore caret right after the inserted token.
      requestAnimationFrame(() => {
        const pos = beforeToken.length + token.length
        ta.focus()
        ta.setSelectionRange(pos, pos)
      })
    },
    [popover, onChange],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When the popover is open, Enter accepts the highlighted item;
    // we let cmdk handle keyboard nav by capturing arrows + Enter on
    // the popover layer below. Escape closes the popover but doesn't
    // submit. Without an open popover, plain Enter submits.
    if (popover) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setPopover(null)
        return
      }
      if (e.key === 'Enter') {
        // The popover's onSelect handles the action via cmdk events
        // routed through the form below; preventDefault here so the
        // textarea doesn't insert a newline before that fires.
        e.preventDefault()
        return
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div ref={wrapRef} className="relative px-3 py-2 border-t border-edge/60">
      {popover && (popover.kind === 'slash' ? slashItems.length > 0 : mentionItems.length > 0 || mentionLoading) && (
        <div
          className="absolute bottom-full left-3 right-3 mb-2 rounded-md border border-edge bg-surface-raised shadow-raised overflow-hidden"
          data-testid="ask-mushi-popover"
        >
          <Command label={popover.kind === 'slash' ? 'Slash commands' : '@ mentions'} loop>
            <div className="px-2 py-1 text-3xs uppercase tracking-wider text-fg-faint border-b border-edge-subtle">
              {popover.kind === 'slash' ? 'Slash commands' : 'Mentions' + (mentionLoading ? ' — searching…' : '')}
            </div>
            <Command.List className="max-h-48 overflow-y-auto">
              {popover.kind === 'slash'
                ? slashItems.map((cmd) => (
                    <Command.Item
                      key={cmd.command}
                      value={cmd.command + ' ' + (cmd.aliases ?? []).join(' ')}
                      onSelect={() => acceptSlash(cmd)}
                      className="cmdk-item"
                    >
                      <span className="font-mono text-2xs text-brand">{cmd.command}</span>
                      <span className="text-2xs text-fg-secondary">{cmd.label}</span>
                      <span className="ml-auto text-3xs text-fg-faint truncate">{cmd.hint}</span>
                    </Command.Item>
                  ))
                : mentionItems.map((m) => (
                    <Command.Item
                      key={`${m.kind}:${m.id}`}
                      value={`${m.kind}:${m.id} ${m.label} ${m.sublabel ?? ''}`}
                      onSelect={() => acceptMention(m)}
                      className="cmdk-item"
                    >
                      <span className="font-mono text-2xs text-brand">{m.label}</span>
                      {m.sublabel && (
                        <span className="ml-auto text-3xs text-fg-faint truncate">{m.sublabel}</span>
                      )}
                    </Command.Item>
                  ))}
            </Command.List>
          </Command>
        </div>
      )}

      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          // Defer to next tick so caret position has updated.
          requestAnimationFrame(updatePopover)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={updatePopover}
        onClick={updatePopover}
        rows={2}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full resize-none bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/40 disabled:opacity-60"
      />
    </div>
  )
}
