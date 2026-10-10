import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser typings are loose at runtime
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it

import rule from './no-hand-rolled-dialog.js'

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

const err = [{ messageId: 'handRolledDialog' }]

tester.run('no-hand-rolled-dialog', rule, {
  valid: [
    { code: '<div className="fixed inset-0" aria-modal="false" />' },
    { code: '<div className="fixed inset-0" aria-modal={false} />' },
    { code: '<div className="fixed inset-0" />' },
    { code: '<Modal className="fixed inset-0" role="dialog" />' },
  ],
  invalid: [
    { code: '<div className="fixed inset-0" role="dialog" />', errors: err },
    { code: '<div className="fixed inset-0" aria-modal />', errors: err },
    { code: '<div className="fixed inset-0" aria-modal="true" />', errors: err },
    { code: '<div className="fixed inset-0" aria-modal={true} />', errors: err },
    { code: '<div className="fixed inset-0" aria-modal={open} />', errors: err },
  ],
})
