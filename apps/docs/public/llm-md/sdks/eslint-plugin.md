# eslint-plugin-mushi-mushi

Source: https://kensaur.us/mushi-mushi/docs/sdks/eslint-plugin

---
title: 'eslint-plugin-mushi-mushi'
---

# `eslint-plugin-mushi-mushi`

Two lint rules that run as part of the v2 gates — **`no-dead-handler`**
flags empty event handlers (`onClick={() => {}}`, `onSubmit={noop}`) and
**`no-mock-leak`** flags faker / placeholder data left in production
paths. The composite GitHub check fails when either rule reports.

## Install

```bash
pnpm add -D eslint-plugin-mushi-mushi
```

## Recommended preset

Most projects pick up both rules at their default severity by extending
the recommended preset:

```js filename="eslint.config.js"

export default [
  // …your other configs
  {
    plugins: { 'mushi-mushi': mushi },
    rules: {
      ...mushi.configs.recommended.rules,
    },
  },
]
```

For legacy `.eslintrc`:

```json
{
  "plugins": ["mushi-mushi"],
  "extends": ["plugin:mushi-mushi/recommended"]
}
```

## Rules

### `mushi-mushi/no-dead-handler`

Flags JSX event handlers whose body is empty, only logs, or is a no-op
arrow (`() => {}`). The CI gate fails on any non-test file that matches.

```jsx
// ✗ caught
 {}}>Submit
Submit

// ✓ allowed
 mutate()}>Submit
Submit

// ✓ allowed in tests + stories
 {}} />        // foo.test.tsx, *.stories.tsx
```

### `mushi-mushi/no-mock-leak`

Flags arrays of placeholder data (`John Doe`, `lorem ipsum`, `faker.*`,
`@faker-js/faker`) that live outside `**/*test*`, `**/*stories*`,
`**/__mocks__/**`, or `**/fixtures/**`. The intent is to catch the
moment a developer leaves their seed data wired up in a real page.

```ts
// ✗ caught — apps/web/src/pages/Dashboard.tsx
const projects = [
  { name: 'John Doe', tasks: 12 },
  { name: 'Jane Doe', tasks: 7 },
]

// ✓ allowed — apps/web/src/__mocks__/projects.ts

  { name: 'John Doe', tasks: 12 },
]
```

## Combining with the gates action

Both rules surface as part of [`@mushi-mushi/mcp-ci`](/sdks/mcp-ci)'s
composite GitHub check. You can also run the rules locally (`pnpm lint`)
and fix violations before pushing — the action will pick the same set
back up in CI.
