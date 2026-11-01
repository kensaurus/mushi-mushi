/**
 * Shared surfaces for page help / guide tooltips.
 *
 * Neutral chrome, not a tint. These used the `ok` success green as
 * decoration, so every page opened with a green "success"-looking bar and the
 * green washed into the white page — while real success states used the same
 * green. `bg-chrome` / `border-chrome-border` exist for exactly this
 * structural page chrome (see theme-tokens.css).
 */

/** Collapsible page-help banner (`PageHelpBanner`, `PageHelp`). */
export const PAGE_HELP_BANNER_SHELL = 'border-chrome-border bg-chrome'

export const PAGE_HELP_BANNER_SUMMARY_HOVER = 'hover:bg-surface-hover hover:text-fg'

export const PAGE_HELP_BANNER_INNER_BORDER = 'border-chrome-border'

/** Inner section cards inside an expanded help banner. */
export const PAGE_HELP_SECTION_SHELL =
  'rounded-sm border border-edge-subtle px-2.5 py-2'

/** Hover tooltip popover (`Tooltip` in ui/misc). */
export const TOOLTIP_POPOVER_SHELL =
  'border-edge-subtle bg-surface-raised text-fg shadow-lg backdrop-blur-sm'

/** Field-level config help popover (`ConfigHelp`). */
export const CONFIG_HELP_POPOVER_SHELL =
  'border-edge-subtle bg-surface-raised shadow-overlay backdrop-blur-sm'
