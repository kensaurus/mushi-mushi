import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser typings are loose at runtime
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it

import rule from './no-raw-semantic-on-muted.js'

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

describe('no-raw-semantic-on-muted', () => {
  tester.run('no-raw-semantic-on-muted', rule as never, {
    valid: [
      {
        filename: 'apps/admin/src/pages/HealthPage.tsx',
        code: `<span className={CHIP_TONE.okSubtle} />`,
      },
      {
        filename: 'apps/admin/src/pages/HealthPage.tsx',
        code: `<span className="bg-warn-muted text-warning-foreground" />`,
      },
      {
        filename: 'apps/admin/src/pages/HealthPage.tsx',
        code: `<button className="text-danger hover:bg-danger-muted/50" />`,
      },
    ],
    invalid: [
      {
        filename: 'apps/admin/src/pages/HealthPage.tsx',
        code: `<span className="bg-ok-muted text-ok border border-ok/30" />`,
        errors: [{ messageId: 'rawSemanticOnMuted' }],
      },
      {
        filename: 'apps/admin/src/pages/DriftPage.tsx',
        code: `<span className="bg-danger-muted/50 text-danger" />`,
        errors: [{ messageId: 'rawSemanticOnMuted' }],
      },
    ],
  })
})
