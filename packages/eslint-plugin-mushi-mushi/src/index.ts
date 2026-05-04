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

const PLUGIN_NAME = 'mushi-mushi'

const rules: Record<string, Rule.RuleModule> = {
  'no-dead-handler': noDeadHandler,
  'no-mock-leak': noMockLeak,
}

const recommendedRules: Linter.RulesRecord = {
  [`${PLUGIN_NAME}/no-dead-handler`]: 'error',
  [`${PLUGIN_NAME}/no-mock-leak`]: 'error',
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
export { rules, recommendedRules }
