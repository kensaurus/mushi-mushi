# mushi-mushi/eslint

Source: https://kensaur.us/mushi-mushi/docs/sdks/eslint-plugin

---
title: 'mushi-mushi/eslint'
description: ESLint rules in mushi-mushi/eslint that catch what AI coding tools leave behind, such as buttons that do nothing and placeholder data left in real pages.
---

# `mushi-mushi/eslint`: catch what AI tools leave behind

AI coding tools often ship two quiet bugs. A button looks finished, but its
click does nothing. Or a page still shows the fake data the AI used while
building it (John Doe, lorem ipsum). Nothing crashes, so no error tracker
sees either one. Your users do.

`mushi-mushi/eslint` finds both while you build. ESLint (the tool that checks
your code for mistakes as you type) runs these rules in your editor, in
`npm run lint` and in CI.

- It comes with `mushi-mushi`, so if your app has ESLint there is nothing extra to install.
- Add two lines to `eslint.config.js`.
- Your editor underlines empty click handlers and leftover fake data.

## Turn it on

You need `mushi-mushi` and ESLint 8 or newer in your project. Most apps made
with Vite, Next.js or an AI builder have ESLint already. `mushi-mushi` does
not install ESLint for you.

```bash
npm install mushi-mushi
```

Then add the recommended rules to your ESLint config:

```js filename="eslint.config.js"
import mushi from 'mushi-mushi/eslint'

export default [
  // …your other configs
  mushi.configs.recommended,
]
```

**You'll see:** `npx eslint .` (or your editor) flags `onClick={() => {}}` and arrays of John Doe placeholder data in your pages.

Prefer to ask your AI editor? Paste this:

```text
Add the Mushi Mushi ESLint rules to this project: import mushi from
'mushi-mushi/eslint' in eslint.config.js and add mushi.configs.recommended to
the exported array. Then run the linter and fix what it reports.
```

### Pick the rules yourself

```js filename="eslint.config.js"
import mushi from 'mushi-mushi/eslint'

export default [
  {
    plugins: { 'mushi-mushi': mushi },
    rules: {
      'mushi-mushi/no-dead-handler': 'error',
      'mushi-mushi/no-mock-leak': 'error',
    },
  },
]
```

`recommended` is also a named export:
`import { recommended } from 'mushi-mushi/eslint'`. In a CommonJS config, use
`require('mushi-mushi/eslint').default`.

### Coming from `eslint-plugin-mushi-mushi`?

The rules moved into `mushi-mushi/eslint`. `eslint-plugin-mushi-mushi` is no
longer published; its last version, 0.3.7, still installs. To switch, change
the import to `mushi-mushi/eslint`. The rule names stay the same.

`mushi-mushi/eslint` works with flat config (`eslint.config.js`, the default
since ESLint 9) only. An older `.eslintrc` loads plugins by package name, so
it cannot load a subpath. Move to flat config to use it.

## What the recommended rules catch

`mushi.configs.recommended` turns on three rules: `no-dead-handler` and
`no-mock-leak` below, plus `no-allowlist-jsx-textnode`, which catches an
allowlist comment written as JSX text (it would show up on the page).

The other 16 rules check the Mushi Mushi console's own design system (tokens,
``, ``, page posture, the widget theme). They are in
`configs.internal` and are not meant for other apps.

### `mushi-mushi/no-dead-handler`: buttons that do nothing

Flags inline event handlers (`on*` props, and `onClick` / `onSubmit`-style
object keys) whose body is empty, returns `null`, holds only `console.*`
calls in a block, or throws "not implemented", including inside
`useCallback`. It checks inline functions only: a handler passed by name,
such as `onSubmit={noop}`, is not followed. Files named `*.test.*`,
`*.spec.*` and `*.stories.*` are skipped.

```jsx
// ✗ caught
<button onClick={() => {}}>Submit</button>
<button onClick={() => { console.log('clicked') }}>Save</button>

// ✓ allowed
<button onClick={() => mutate()}>Submit</button>
<form onSubmit={handleSubmit}><button type="submit">Submit</button></form>

// ✓ allowed in tests + stories
<button onClick={() => {}} />        // foo.test.tsx, *.stories.tsx
```

### `mushi-mushi/no-mock-leak`: fake data in real pages

Flags mock-library imports (`@faker-js/faker`, `faker`, `msw`, and
similar), arrays of placeholder objects (`John Doe`, `Jane Doe`), and
`lorem ipsum` or `placeholder@example.com` strings in production files. It
skips files under a `__tests__`, `test`, `tests`, `spec`, `stories`,
`fixtures`, `mocks` or `__mocks__` folder, and files named `*.test.*`,
`*.spec.*`, `*.stories.*` or `*.mock.*`.

```ts
// ✗ caught — apps/web/src/pages/Dashboard.tsx
const projects = [
  { name: 'John Doe', tasks: 12 },
  { name: 'Jane Doe', tasks: 7 },
]

// ✓ allowed — apps/web/src/__mocks__/projects.ts
export const projects = [
  { name: 'John Doe', tasks: 12 },
]
```

## In CI

Run ESLint as its own step (for example `npx eslint .`) so a pull request
fails when either rule reports. To record the findings in Mushi Mushi as
well, write a JSON report (`npx eslint -f json -o mushi-eslint.json src/`)
and pass it to the [`@mushi-mushi/mcp-ci`](/sdks/mcp-ci) `gates` command as
`eslint-report`. That command does not run ESLint itself, and its
`dead_handler` and `mock_leak` gates fail when no report is given.
