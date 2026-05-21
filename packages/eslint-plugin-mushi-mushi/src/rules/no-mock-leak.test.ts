import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
// @ts-expect-error — parser ships its own loose typings; we only need
// the default-export factory function at runtime.
import tsParser from '@typescript-eslint/parser'

;(RuleTester as unknown as { describe: typeof describe }).describe = describe
;(RuleTester as unknown as { it: typeof it }).it = it
;(RuleTester as unknown as { itOnly: typeof it.only }).itOnly = it.only

import rule from './no-mock-leak.js'

// Round 8 (B15): wired the TypeScript parser so the test fixtures exercise
// real-world TS-flavoured user code (interfaces, satisfies, type imports)
// instead of being silent parse errors.
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
      {
        // TS: type-only import — we shouldn't trip the mock-import detector.
        filename: '/proj/src/users.ts',
        code: `import type { faker } from '@faker-js/faker'`,
      },
      {
        // TS: interface declaration with placeholder-y field name (no value).
        filename: '/proj/src/types.ts',
        code: `interface User { name: string }`,
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
