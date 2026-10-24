/**
 * FILE: no-redundant-border-on-chip-tone.test.ts
 * PURPOSE: CHIP_TONE already includes one resting border. A second
 *          `border-<tone>/<n>` next to the recipe is the warning this rule
 *          exists for. `hover:` / `focus:` / `active:` border utilities are
 *          the control's hover colour, not a second resting border — button
 *          variants lost that colour when the rule treated them as redundant.
 */

import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser typings are loose at runtime
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it

import rule from './no-redundant-border-on-chip-tone.js'

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
})

describe('no-redundant-border-on-chip-tone', () => {
  tester.run('no-redundant-border-on-chip-tone', rule as never, {
    valid: [
      {
        code: 'const chip = `${CHIP_TONE.okSubtle}`',
      },
      {
        // Bare `border` sets the same 1px width the recipe already sets.
        // The rule does not flag it (call sites drop it by hand).
        code: 'const chip = `rounded-md border ${CHIP_TONE.okSubtle}`',
      },
      {
        code: 'const cancel = `${CHIP_TONE.danger} hover:bg-danger-muted hover:border-danger/50 hover:-translate-y-px`',
      },
      {
        code: 'const danger = `${CHIP_TONE.dangerSubtle} hover:bg-danger-muted/80 hover:border-danger/40 hover:shadow-glow-danger hover:-translate-y-px`',
      },
      {
        code: 'const success = `${CHIP_TONE.okSubtle} hover:bg-ok-muted/80 hover:border-ok/40 hover:shadow-glow-ok hover:-translate-y-px`',
      },
      {
        code: 'const chip = `${CHIP_TONE.okSubtle} focus-visible:border-ok/40 active:border-ok/50`',
      },
      {
        code: "const cancel = CHIP_TONE.danger + ' hover:border-danger/50'",
      },
      {
        code: 'const el = <button className={`${CHIP_TONE.dangerSubtle} hover:border-danger/40`} />',
      },
      {
        code: `const chip =
          // mushi-mushi-allowlist: one control keeps a stronger resting border
          \`\${CHIP_TONE.danger} border-danger/40\``,
      },
      {
        // No CHIP_TONE in this string — the rule does not apply.
        code: 'const el = <button className="border border-danger/40 hover:border-danger/50" />',
      },
    ],
    invalid: [
      {
        code: 'const chip = `${CHIP_TONE.okSubtle} border-ok/30`',
        errors: [{ messageId: 'redundantBorder' }],
      },
      {
        code: 'const chip = `border-warn/30 ${CHIP_TONE.warnSubtle}`',
        errors: [{ messageId: 'redundantBorder' }],
      },
      {
        code: 'const chip = `${CHIP_TONE.danger} border border-danger/40`',
        errors: [{ messageId: 'redundantBorder' }],
      },
      {
        // Hover colour is fine; the resting override is not.
        code: 'const cancel = `${CHIP_TONE.danger} border-danger/40 hover:bg-danger-muted hover:border-danger/50`',
        errors: [{ messageId: 'redundantBorder' }],
      },
      {
        code: 'const chip = `${CHIP_TONE.dangerSubtle} md:border-danger/40`',
        errors: [{ messageId: 'redundantBorder' }],
      },
      {
        code: "const chip = CHIP_TONE.okSubtle + ' border-ok/30'",
        errors: [{ messageId: 'redundantBorder' }],
      },
      {
        code: 'const el = <span className={`${CHIP_TONE.warnSubtle} border-warn/30`} />',
        errors: [{ messageId: 'redundantBorder' }],
      },
    ],
  })
})
