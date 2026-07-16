// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * eslint-plugin-mushi-mushi
 *
 * Two rules implementing whitepaper Gates 1 and 2:
 *   - `no-dead-handler` — flags empty / placeholder handlers attached
 *      to UI elements. The single biggest agentic-coding failure mode.
 *   - `no-mock-leak`   — flags faker / msw imports + obvious placeholder
 *      arrays in production-path source files.
 *
 * Both ship under MIT so customers can drop them into existing flat or
 * legacy ESLint configs without paying for Mushi Mushi (whitepaper §8.4).
 *
 * Usage (flat config):
 *
 *   import mushi from 'eslint-plugin-mushi-mushi'
 *   export default [
 *     mushi.configs.recommended,
 *   ]
 *
 * Usage (legacy):
 *
 *   {
 *     "plugins": ["mushi-mushi"],
 *     "extends": ["plugin:mushi-mushi/recommended"]
 *   }
 */

import type { ESLint, Linter, Rule } from 'eslint'

import noDeadHandler from './rules/no-dead-handler.js'
import noMockLeak from './rules/no-mock-leak.js'
import noRawPaletteColor from './rules/no-raw-palette-color.js'
import noText3xsOnInteractive from './rules/no-text-3xs-on-interactive.js'
import noHandRolledDialog from './rules/no-hand-rolled-dialog.js'
import noHandRolledTablist from './rules/no-hand-rolled-tablist.js'
import noMissingPagePosture from './rules/no-missing-page-posture.js'
import noLegacyShadcnTokens from './rules/no-legacy-shadcn-tokens.js'
import noAccentForSelection from './rules/no-accent-for-selection.js'
import noRawHexInWidget from './rules/no-raw-hex-in-widget.js'
import noCardElevatedOutsideAllowlist from './rules/no-card-elevated-outside-allowlist.js'
import noRawSemanticOnMuted from './rules/no-raw-semantic-on-muted.js'
import noRawCssVarText from './rules/no-raw-css-var-text.js'
import noRedundantBorderOnChipTone from './rules/no-redundant-border-on-chip-tone.js'
import noLegacyPageHeaderInPages from './rules/no-legacy-page-header-in-pages.js'
import noPageRootPadding from './rules/no-page-root-padding.js'
import noArbitraryLengthValue from './rules/no-arbitrary-length-value.js'
import preferCardPrimitive from './rules/prefer-card-primitive.js'

const PLUGIN_NAME = 'mushi-mushi'

const rules: Record<string, Rule.RuleModule> = {
  'no-dead-handler': noDeadHandler,
  'no-mock-leak': noMockLeak,
  'no-raw-palette-color': noRawPaletteColor,
  'no-text-3xs-on-interactive': noText3xsOnInteractive,
  'no-hand-rolled-dialog': noHandRolledDialog,
  'no-hand-rolled-tablist': noHandRolledTablist,
  'no-missing-page-posture': noMissingPagePosture,
  'no-legacy-shadcn-tokens': noLegacyShadcnTokens,
  'no-accent-for-selection': noAccentForSelection,
  'no-raw-hex-in-widget': noRawHexInWidget,
  'no-card-elevated-outside-allowlist': noCardElevatedOutsideAllowlist,
  'no-raw-semantic-on-muted': noRawSemanticOnMuted,
  'no-raw-css-var-text': noRawCssVarText,
  'no-redundant-border-on-chip-tone': noRedundantBorderOnChipTone,
  'no-legacy-page-header-in-pages': noLegacyPageHeaderInPages,
  'no-page-root-padding': noPageRootPadding,
  'no-arbitrary-length-value': noArbitraryLengthValue,
  'prefer-card-primitive': preferCardPrimitive,
}

const recommendedRules: Linter.RulesRecord = {
  [`${PLUGIN_NAME}/no-dead-handler`]: 'error',
  [`${PLUGIN_NAME}/no-mock-leak`]: 'error',
  [`${PLUGIN_NAME}/no-raw-palette-color`]: 'warn',
  [`${PLUGIN_NAME}/no-text-3xs-on-interactive`]: 'warn',
  [`${PLUGIN_NAME}/no-hand-rolled-dialog`]: 'error',
  [`${PLUGIN_NAME}/no-hand-rolled-tablist`]: 'warn',
  [`${PLUGIN_NAME}/no-missing-page-posture`]: 'warn',
  [`${PLUGIN_NAME}/no-legacy-shadcn-tokens`]: 'warn',
  [`${PLUGIN_NAME}/no-accent-for-selection`]: 'warn',
  [`${PLUGIN_NAME}/no-raw-hex-in-widget`]: 'error',
  [`${PLUGIN_NAME}/no-card-elevated-outside-allowlist`]: 'warn',
  [`${PLUGIN_NAME}/no-raw-semantic-on-muted`]: 'warn',
  [`${PLUGIN_NAME}/no-raw-css-var-text`]: 'warn',
  [`${PLUGIN_NAME}/no-redundant-border-on-chip-tone`]: 'warn',
  // Admin scaffold anti-drift — start warn; ratchet after Start-here cluster is clean.
  [`${PLUGIN_NAME}/no-legacy-page-header-in-pages`]: 'error',
  [`${PLUGIN_NAME}/no-page-root-padding`]: 'error',
  [`${PLUGIN_NAME}/no-arbitrary-length-value`]: 'error',
  [`${PLUGIN_NAME}/prefer-card-primitive`]: 'error',
}

/**
 * Default export — works as both a flat-config plugin and a legacy plugin.
 * The shape (`rules` + `configs`) is what ESLint expects from a flat-config
 * plugin object, and the `meta` block makes it self-identify in errors.
 *
 * `configs` is intentionally typed as `Record<string, unknown>` so we can
 * register both flat (`{plugins: {…}, rules: …}`) and legacy
 * (`{plugins: [...], rules: …}`) shapes side-by-side. ESLint validates
 * the chosen shape at the consumer's call site.
 */
interface MushiPlugin {
  meta: { name: string; version: string }
  rules: Record<string, Rule.RuleModule>
  configs: Record<string, unknown>
}

const plugin: MushiPlugin = {
  meta: { name: 'eslint-plugin-mushi-mushi', version: '0.1.0' },
  rules,
  configs: {},
}

plugin.configs.recommended = {
  plugins: { [PLUGIN_NAME]: plugin as unknown as ESLint.Plugin },
  rules: recommendedRules,
}
plugin.configs.legacy = {
  plugins: [PLUGIN_NAME],
  rules: recommendedRules,
}

export default plugin
