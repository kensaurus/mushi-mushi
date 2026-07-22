/**
 * CodeFramePanel — Phase 4d
 *
 * Renders parsed stack frames from console error entries as a navigable list,
 * with each frame linked to the matching line in the GitHub repo at the commit
 * where the fix was applied.
 *
 * This closes the "back to the code/commit" provenance loop:
 *   console error → stack trace → file:line → GitHub blob URL → code review / fix.
 *
 * Data sources:
 *   - `consoleLogs`: SDK-captured console entries (error level have `.stack` field).
 *   - `repoUrl`:     project.repo_url (e.g. "https://github.com/org/repo").
 *   - `commitSha`:   fix_attempts[0].commit_sha (most recent fix commit, if any).
 *
 * When no commit SHA is available, frames are rendered without links.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CodeFrame {
  /** Display label: function name (if parsed) or raw frame. */
  label: string
  /** Repo-relative file path, e.g. "src/api/handler.ts". */
  file: string
  line: number
  column: number
  /** GitHub blob URL with line anchor, e.g. "https://github.com/.../blob/<sha>/src/...#L42". */
  href?: string
  /** Raw frame text for tooltip / copy. */
  raw: string
}

interface ConsoleLogEntry {
  level: string
  message: string
  timestamp: number
  stack?: string
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse V8-style stack frames from a stack string.
 * Handles both "at FnName (file.ts:10:5)" and "at file.ts:10:5" forms.
 * Skips Mushi SDK-internal frames (contains "mushi-mushi" or "@mushi").
 */
function parseStackFrames(stack: string): { fn?: string; file: string; line: number; col: number; raw: string }[] {
  const frames: { fn?: string; file: string; line: number; col: number; raw: string }[] = []
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

/** Strip protocol + origin from a bundled file path (common in browser stacks). */
function stripOrigin(file: string): string {
  try {
    const u = new URL(file)
    return u.pathname.replace(/^\//, '')
  } catch {
    return file.replace(/^\/+/, '')
  }
}

function buildFrames(stack: string, repoUrl: string | null, commitSha: string | null): CodeFrame[] {
  const raw = parseStackFrames(stack)
  return raw.map(({ fn, file, line, col, raw: rawLine }) => {
    const cleanFile = stripOrigin(file)
    let href: string | undefined
    if (repoUrl && commitSha && cleanFile) {
      const base = repoUrl.replace(/\/$/, '')
      href = `${base}/blob/${commitSha}/${cleanFile}#L${line}`
    }
    return {
      label: fn ? `${fn} (${cleanFile}:${line})` : `${cleanFile}:${line}:${col}`,
      file: cleanFile,
      line,
      column: col,
      href,
      raw: rawLine,
    }
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CodeFramePanel({
  consoleLogs,
  repoUrl,
  commitSha,
}: {
  consoleLogs: ConsoleLogEntry[] | null | undefined
  /** GitHub repo URL, e.g. "https://github.com/acme/app". Used to build blob deeplinks. */
  repoUrl?: string | null
  /** Git commit SHA to anchor links to. Typically fix_attempts[0].commit_sha. */
  commitSha?: string | null
}) {
  // Collect all unique frames from error-level console entries that have a stack.
  const errorLogs = (consoleLogs ?? []).filter(
    (l) => (l.level === 'error' || l.level === 'warn') && l.stack,
  )

  if (errorLogs.length === 0) return null

  // Dedupe frames by file:line across all error entries.
  const seen = new Set<string>()
  const allFrames: (CodeFrame & { fromMessage: string })[] = []

  for (const log of errorLogs) {
    if (!log.stack) continue
    const frames = buildFrames(log.stack, repoUrl ?? null, commitSha ?? null)
    for (const f of frames) {
      const key = `${f.file}:${f.line}`
      if (!seen.has(key)) {
        seen.add(key)
        allFrames.push({ ...f, fromMessage: String(log.message).slice(0, 80) })
      }
    }
    if (allFrames.length >= 15) break
  }

  if (allFrames.length === 0) return null

  return (
    <div className="rounded-sm border border-edge-subtle bg-surface-overlay/40 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 border-b border-edge-subtle/40 bg-surface-overlay/60">
        <span className="text-2xs font-semibold text-fg-secondary">Stack frames</span>
        {commitSha && (
          <span className="font-mono text-3xs text-fg-faint" title={commitSha}>
            @ {commitSha.slice(0, 7)}
          </span>
        )}
      </div>

      <ol className="divide-y divide-edge-subtle/20 list-none m-0 p-0">
        {allFrames.map((f, i) => (
          <li
            key={i}
            className="flex items-start gap-2 px-2 py-1 text-2xs group"
            title={f.raw}
          >
            {/* Frame index */}
            <span className="shrink-0 font-mono text-3xs text-fg-faint tabular-nums mt-0.5 w-4 text-right">
              {i + 1}
            </span>

            {/* File + line */}
            <span className="min-w-0 flex-1">
              {f.href ? (
                <a
                  href={f.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-brand underline-offset-2 hover:underline truncate block"
                  title={`Open ${f.file}:${f.line} in GitHub`}
                >
                  {f.label}
                </a>
              ) : (
                <span className="font-mono text-fg-secondary truncate block">{f.label}</span>
              )}
              <span className="text-3xs text-fg-faint truncate block" title={f.fromMessage}>
                from: {f.fromMessage}
              </span>
            </span>

            {/* Column */}
            <span className="shrink-0 font-mono text-3xs text-fg-faint tabular-nums mt-0.5">
              col {f.column}
            </span>
          </li>
        ))}
      </ol>

      {!repoUrl && (
        <p className="px-2 py-1.5 text-3xs text-fg-faint border-t border-edge-subtle/20">
          Connect a repo URL in project settings to enable GitHub deeplinks.
        </p>
      )}
      {repoUrl && !commitSha && (
        <p className="px-2 py-1.5 text-3xs text-fg-faint border-t border-edge-subtle/20">
          Waiting for a fix commit — links will appear after the first fix is merged.
        </p>
      )}
    </div>
  )
}
