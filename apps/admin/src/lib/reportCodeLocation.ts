/**
 * FILE: apps/admin/src/lib/reportCodeLocation.ts
 * PURPOSE: Does a report point at code a fix agent could change? (BL-061)
 *
 * Web-vital and native-crash reports often carry no first-party stack frame,
 * no file and no failed request. A dispatched agent then has nothing to edit
 * and the review gate refuses its comment-only patch (6 of 8 dispatches on
 * 2026-10-16). The report page uses this to lead with "Not a code bug" and
 * keep "Dispatch anyway" as the second choice.
 *
 * True when any of these hold:
 *   - a console error/warn stack has a first-party frame (parseStackFrames,
 *     the parser CodeFramePanel renders). A stack with only a message line,
 *     `(?)` frames or JVM frames without columns does not count;
 *   - Sentry ingest stored an in-app source path (`custom_metadata.sentryFrames`,
 *     which skips `in_app: false` frames; `_shared/sentry-frames.ts`);
 *   - the classifier named a file: a path token with a `/` and a code
 *     extension in the component. A prose component name does not count;
 *   - a captured request failed (status >= 400, or an error).
 */

import type { ReportDetail } from '../components/report-detail/types'

export interface ParsedStackFrame {
  fn?: string
  file: string
  line: number
  col: number
  raw: string
}

/**
 * Parse V8-style stack frames from a stack string.
 * Handles both "at FnName (file.ts:10:5)" and "at file.ts:10:5" forms.
 * Skips dependency, bundler and Mushi SDK frames, that is every file path containing
 * "node_modules", "webpack:" or "mushi-mushi" (which covers @mushi-mushi/*).
 */
export function parseStackFrames(stack: string): ParsedStackFrame[] {
  const frames: ParsedStackFrame[] = []
  // e.g. "    at SomeFunction (src/foo.ts:10:5)" or "    at src/foo.ts:10:5"
  const V8_FRAME = /^\s+at\s+(?:(.+?)\s+\((.+):(\d+):(\d+)\)|(.+):(\d+):(\d+))\s*$/

  for (const line of stack.split('\n')) {
    const m = line.match(V8_FRAME)
    if (!m) continue

    const [, fn, file1, lineNum1, col1, file2, lineNum2, col2] = m
    const file = file1 ?? file2 ?? ''
    const lineN = parseInt(lineNum1 ?? lineNum2 ?? '0', 10)
    const colN = parseInt(col1 ?? col2 ?? '0', 10)

    // Skip internal / bundler frames.
    if (file.includes('node_modules') || file.includes('webpack:') || file.includes('mushi-mushi')) continue

    frames.push({ fn: fn?.trim() || undefined, file, line: lineN, col: colN, raw: line.trim() })
    if (frames.length >= 10) break // cap at 10 frames
  }
  return frames
}

/** A path token like `features/chat/chat-input.tsx`: a folder and a code extension. */
const FILE_PATH_RE = /[\w@.-]+\/[\w@./-]*\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|rb|go|rs|java|kt|kts|swift|dart|php|cs|ex|exs|scala)\b/i

function namesFile(value: unknown): boolean {
  return typeof value === 'string' && FILE_PATH_RE.test(value)
}

type CodeLocationSource = Pick<
  ReportDetail,
  'console_logs' | 'network_logs' | 'component' | 'stage1_classification' | 'stage2_analysis' | 'custom_metadata'
>

export function reportHasCodeLocation(report: CodeLocationSource): boolean {
  const stackHasFrame = (report.console_logs ?? []).some(
    (l) => (l.level === 'error' || l.level === 'warn') && !!l.stack && parseStackFrames(l.stack).length > 0,
  )
  if (stackHasFrame) return true

  const sentryFrames = report.custom_metadata?.sentryFrames
  if (Array.isArray(sentryFrames) && sentryFrames.some((p) => typeof p === 'string' && p.length > 0)) return true

  if (
    namesFile(report.component) ||
    namesFile(report.stage1_classification?.component) ||
    namesFile(report.stage2_analysis?.component)
  ) {
    return true
  }

  return (report.network_logs ?? []).some((n) => n.status >= 400 || !!n.error)
}

/** The one sentence the report page shows when the answer is no. */
export const NO_CODE_LOCATION_REASON =
  "This report has no stack trace or file to change, so a fix agent usually can't act on it."
