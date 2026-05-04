import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it
;(RuleTester as unknown as { itOnly: typeof it.only }).itOnly = it.only

import rule from './no-mock-leak.js'

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
})

describe('no-mock-leak', () => {
  tester.run('no-mock-leak', rule as never, {
    valid: [
      {
        // Test path → rule short-circuits, even if it imports faker.
        filename: '/proj/src/__tests__/users.test.ts',
        code: `import { faker } from '@faker-js/faker'\nfaker.name.fullName()`,
      },
      {
        filename: '/proj/src/users.ts',
        code: `const u = { name: 'Alice Cooper' }`,
      },
      {
        filename: '/proj/src/lib/api.ts',
        code: `import { fetchUsers } from '@/api/users'`,
      },
      {
        // Single John Doe, not 2+ entries → not flagged.
        filename: '/proj/src/users.ts',
        code: `const sample = [{ name: 'John Doe' }]`,
      },
    ],
    invalid: [
      {
        filename: '/proj/src/lib/api.ts',
        code: `import { faker } from '@faker-js/faker'`,
        errors: [{ messageId: 'mockImport', data: { module: '@faker-js/faker' } }],
      },
      {
        filename: '/proj/src/lib/api.ts',
        code: `import { setupServer } from 'msw/node'`,
        errors: [{ messageId: 'mockImport', data: { module: 'msw/node' } }],
      },
      {
        filename: '/proj/src/users.ts',
        code: `const sample = [{ name: 'John Doe' }, { name: 'Jane Doe' }, { name: 'John Doe' }]`,
        errors: [{ messageId: 'placeholderArray' }],
      },
      {
        filename: '/proj/src/banner.ts',
        code: `const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'`,
        errors: [{ messageId: 'placeholderText' }],
      },
      {
        filename: '/proj/src/contact.ts',
        code: `const email = 'placeholder@example.com'`,
        errors: [{ messageId: 'placeholderText' }],
      },
    ],
  })
})
