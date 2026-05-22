export const editorialTokens = {
  paper: '#f8f4ed',
  ink: '#0e0d0b',
  vermillion: '#e03c2c',
  fontDisplay:
    '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Cambria, Georgia, "Times New Roman", serif',
  fontMono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace',
}

/**
 * Canonical tagline ladder — the ONLY allowed phrasing for public surfaces.
 * Import and use these constants instead of hard-coding. See docs/marketing/VOICE.md.
 *
 * CI: scripts/check-tagline-consistency.mjs fails on any README that opens with
 * a variant not in this ladder.
 */
export const MUSHI_TAGLINE = {
  /** Full 12-word form — use in README headers, landing H1, docs landing. */
  full: 'Sentry sees what code throws. Mushi sees what users feel — and closes the loop with AI.',
  /** 5-word punchy form — use in social bios, npm descriptions, secondary headlines. */
  short: 'Bug reports that close themselves.',
  /** 3-word imperative form — use in CTAs, slide headers, og:description. */
  micro: 'Capture. Classify. Fix.',
  /** 1-word brand mark — use in logo adjacent, footer whisper. */
  mark: '虫虫',
  /** Sub-tagline positioning line — use as eyebrow or section label. */
  spine: 'the evolution loop for AI-assisted software',
}
