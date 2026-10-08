/**
 * Shared green-nature surfaces for page help / guide tooltips.
 * Calm moss tint — distinct from semantic warn/danger and from flat chrome.
 */

/**
 * Collapsible page-help banner (`PageHelpBanner`, `PageHelp`). Closed, it is a
 * quiet chrome row: a moss-green bar above every page's header read as an
 * alert and tinted the top of each page (owner review, 2026-10-08). The green
 * stays inside the opened guide sections.
 */
export const PAGE_HELP_BANNER_SHELL =
  'border-edge-subtle bg-transparent open:bg-surface-raised'

export const PAGE_HELP_BANNER_SUMMARY_HOVER =
  'hover:bg-surface-hover hover:text-fg'

export const PAGE_HELP_BANNER_INNER_BORDER = 'border-edge-subtle'

/** Inner section cards inside an expanded help banner. */
export const PAGE_HELP_SECTION_SHELL =
  'rounded-sm border border-ok/20 bg-ok-muted/15 px-2.5 py-2'

/** Hover tooltip popover (`Tooltip` in ui/misc). */
export const TOOLTIP_POPOVER_SHELL =
  'border-edge-subtle bg-surface-raised text-fg shadow-lg backdrop-blur-sm'

/** Field-level config help popover (`ConfigHelp`). */
export const CONFIG_HELP_POPOVER_SHELL =
  'border-edge-subtle bg-surface-raised shadow-overlay backdrop-blur-sm'
