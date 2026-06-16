/**
 * FILE: apps/admin/src/lib/askMushiTerminalTheme.ts
 * PURPOSE: Theme-aware Shiki palettes + assistant text cleanup for the
 *          Ask Mushi terminal drawer (Monokai on light app, reversed on dark).
 */

import type { BundledTheme } from 'streamdown'

export function askMushiShikiThemes(resolved: 'light' | 'dark'): [BundledTheme, BundledTheme] {
  // Light app chrome → classic Monokai terminal. Dark app chrome → light parchment reverse.
  return resolved === 'light' ? ['monokai', 'monokai'] : ['one-light', 'one-light']
}

/** Unwrap accidental JSON answer payloads (navigate-mode leak) before markdown render. */
export function formatAssistantMarkdown(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return content

  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  if (fence) return formatAssistantMarkdown(fence[1].trim())

  if (!trimmed.startsWith('{')) return content

  try {
    const parsed = JSON.parse(trimmed) as {
      kind?: string
      text?: string
      question?: string
    }
    if (parsed.kind === 'answer' && typeof parsed.text === 'string') return parsed.text
    if (parsed.kind === 'clarify' && typeof parsed.question === 'string') return parsed.question
  } catch {
    // not JSON — render as-is
  }
  return content
}

const RESUME_THREAD_TITLE_RE = /^\(resume thread [0-9a-f-]{36}\)$/i

/** Human label for thread list rows (hides legacy composer-leak titles). */
export function formatThreadTitle(title: string | null | undefined): string {
  const t = (title ?? '').trim()
  if (!t) return 'Empty thread'
  if (RESUME_THREAD_TITLE_RE.test(t)) return 'Previous conversation'
  if (t.length > 72) return `${t.slice(0, 69)}…`
  return t
}
