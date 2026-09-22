/**
 * Tests for scripts/check-doc-snippets.mjs — run with `pnpm test:scripts`.
 * The type-check itself needs built packages and runs in CI's build job; these
 * cover the extraction rules it depends on.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bareImports, extractSnippets, importStatements, snippetPath } from './check-doc-snippets.mjs'

const DOC = [
  '# Title',
  '```ts filename="src/mushi.ts"',
  "import { Mushi } from '@mushi-mushi/web'",
  'export const mushi = Mushi.init({ projectId: "p", apiKey: "k" })',
  '```',
  '',
  '```tsx snippet-skip="uses the reader\'s <App />"',
  '<App />',
  '```',
  '',
  '  ```ts',
  '  // snippet: skip — continues the block above',
  '  mushi.show()',
  '  ```',
  '',
  '```bash',
  'npm i @mushi-mushi/web',
  '```',
  '',
  '````typescript',
  '// app/providers.tsx',
  "'use client'",
  '```',
  '````',
].join('\n')

test('extractSnippets reads ts/tsx/typescript fences with filename, skip markers and indentation', () => {
  const s = extractSnippets(DOC)
  assert.equal(s.length, 4, 'the bash fence is not a snippet')
  assert.deepEqual(
    s.map((x) => [x.ordinal, x.line, x.lang, x.filename, x.skip]),
    [
      [1, 2, 'ts', 'src/mushi.ts', null],
      [2, 7, 'tsx', null, "uses the reader's <App />"],
      [3, 11, 'ts', null, 'continues the block above'],
      [4, 20, 'ts', 'app/providers.tsx', null],
    ],
  )
  assert.equal(s[2].code, '// snippet: skip — continues the block above\nmushi.show()', 'fence indentation is stripped')
  assert.equal(s[3].code, "// app/providers.tsx\n'use client'\n```", 'a shorter inner fence does not close a longer one')
})

test('a bare snippet-skip token and a reason-less skip comment still skip', () => {
  const s = extractSnippets('```tsx snippet-skip\n<A />\n```\n```ts\n// snippet: skip\nx()\n```\n```ts snippet-skipper\ny()\n```')
  assert.deepEqual(
    s.map((x) => x.skip),
    ['marked snippet-skip', 'marked snippet: skip', null],
  )
})

test('importStatements and bareImports', () => {
  const code = [
    "import { Mushi } from '@mushi-mushi/web'",
    "import type { MushiConfig } from '@mushi-mushi/core';",
    "import App from './App.vue'",
    "import '@angular/compiler'",
    "import { x } from 'node:fs'",
    "const lazy = await import('@mushi-mushi/web/headless')",
    'Mushi.init(config)',
  ].join('\n')
  assert.deepEqual(importStatements(code), [
    "import { Mushi } from '@mushi-mushi/web'",
    "import type { MushiConfig } from '@mushi-mushi/core';",
    "import App from './App.vue'",
    "import '@angular/compiler'",
    "import { x } from 'node:fs'",
  ])
  assert.deepEqual([...bareImports(code)].sort(), ['@angular/compiler', '@mushi-mushi/core', '@mushi-mushi/web'])
})

test('snippetPath keeps filenames inside the document folder and never collides', () => {
  const taken = new Set()
  assert.equal(snippetPath({ ordinal: 1, lang: 'ts', filename: 'src/app/app.config.ts' }, taken), 'src/app/app.config.ts')
  assert.equal(snippetPath({ ordinal: 2, lang: 'tsx', filename: '../../etc/evil.tsx' }, taken), 'etc/evil.tsx')
  assert.equal(snippetPath({ ordinal: 3, lang: 'ts', filename: 'src/app/app.config.ts' }, taken), 'snippet-3-app.config.ts')
  assert.equal(snippetPath({ ordinal: 4, lang: 'tsx', filename: null }, taken), 'snippet-4.tsx')
  assert.equal(snippetPath({ ordinal: 5, lang: 'ts', filename: 'vite.config' }, taken), 'vite.config.ts')
})
