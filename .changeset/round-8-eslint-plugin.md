---
'eslint-plugin-mushi-mushi': patch
---

Fix a real false positive in `no-mock-leak`, and wire the TS parser into
`RuleTester` so the rules are actually exercised against TypeScript.

- `no-mock-leak` no longer flags `import type { faker } from
  '@faker-js/faker'`. Type-only imports are erased at compile time and
  never reach the runtime, so the rule's "no mocks in production"
  contract doesn't apply to them.
- `RuleTester` now registers `@typescript-eslint/parser` so fixtures
  using TypeScript-only syntax (`as` casts, `satisfies`, generics, type
  annotations) parse instead of silently failing as "0 errors". Added
  TS-targeted regression cases.
