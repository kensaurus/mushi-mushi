import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser typings are loose at runtime
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it

import rule from './no-legacy-page-header-in-pages.js'

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

describe('no-legacy-page-header-in-pages', () => {
  tester.run('no-legacy-page-header-in-pages', rule as never, {
    valid: [
      {
        filename: 'apps/admin/src/pages/OverviewPage.tsx',
        code: `import { PageHeaderBar } from '../components/PageHeaderBar'
        export function OverviewPage() { return <PageHeaderBar title="X" /> }`,
      },
      {
        filename: 'apps/admin/src/components/NestedPanel.tsx',
        code: `import { PageHeader } from './ui'
        export function NestedPanel() { return <PageHeader title="X" /> }`,
      },
    ],
    invalid: [
      {
        filename: 'apps/admin/src/pages/LegacyPage.tsx',
        code: `import { PageHeader } from '../components/ui'
        export function LegacyPage() { return <PageHeader title="X" /> }`,
        errors: [
          { messageId: 'legacyPageHeaderImport' },
          { messageId: 'legacyPageHeader' },
        ],
      },
    ],
  })
})
