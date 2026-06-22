import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser typings are loose at runtime
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it

import rule from './no-missing-page-posture.js'

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

describe('no-missing-page-posture', () => {
  tester.run('no-missing-page-posture', rule as never, {
    valid: [
      {
        filename: 'apps/admin/src/pages/LoginPage.tsx',
        code: `export function LoginPage() { return <form /> }`,
      },
      {
        filename: 'apps/admin/src/pages/AuditPage.tsx',
        code: `import { PagePosture } from '../components/PagePosture'
        export function AuditPage() { return <PagePosture slots={[]} /> }`,
      },
      {
        filename: 'apps/admin/src/pages/LegacyPage.tsx',
        code: `// mushi-mushi-allowlist: auth bridge — no operator chrome
        export function LegacyPage() { return null }`,
      },
    ],
    invalid: [
      {
        filename: 'apps/admin/src/pages/NewWorklistPage.tsx',
        code: `export function NewWorklistPage() { return <div /> }`,
        errors: [{ messageId: 'missingPagePosture' }],
      },
    ],
  })
})
