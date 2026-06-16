/**
 * FILE: apps/admin/src/lib/askMushiTerminalTheme.ts
 * PURPOSE: Theme-aware Shiki palettes + assistant text cleanup for the
 *          Ask Mushi terminal drawer (Monokai on light app, reversed on dark).
 */

import type { BundledTheme } from 'streamdown'

export function askMushiShikiThemes(resolved: 'light' | 'dark'): [BundledTheme, BundledTheme] {
  // Light app chrome → classic Monokai terminal. Dark app chrome → light parchment reverse.
  return resolved === 'light' ? ['monokai', 'monokai'] : ['one-light-pro', 'one-light-pro']
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
