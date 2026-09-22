#!/usr/bin/env node
/**
 * FILE: scripts/check-doc-snippets.mjs
 * PURPOSE: Type-check the TypeScript snippets people copy from the quickstarts
 *          and SDK READMEs against the packages we publish.
 *
 * Scope: ```ts / ```tsx / ```typescript fences in
 *   apps/docs/content/quickstart/*.mdx
 *   packages/{web,react,angular,vue}/README.md
 *
 * How: every snippet becomes a file in a temp project — one folder per
 * document, named by the fence's `filename="…"` meta (or a first-line path
 * comment such as `// app/providers.tsx`) when it has one, so a
 * page's `./providers` or `../environments/environment` import resolves to the
 * snippet that defines it. `@mushi-mushi/*` resolve to the workspace packages'
 * BUILT output through their package.json `exports` (what an npm install
 * gets), so run this after `pnpm build`. Frameworks (react, vue,
 * @angular/core, …) resolve from the SDK package that depends on them. The
 * only ambient types added are what the snippets' own toolchains provide:
 * Vite's `import.meta.env` and the `*.vue` module shim a Vue + TS project
 * ships. A snippet with no import statement of its own continues the closest
 * earlier snippet in the same document and is checked with that snippet's
 * imports prepended. Then the workspace's TypeScript checks the lot once,
 * strict, with syntax and type errors reported for every snippet.
 *
 * INTENTIONALLY PARTIAL SNIPPETS
 *   Mark a fence that is not meant to compile on its own (a fragment that
 *   continues the previous block, or one that uses the reader's own
 *   components) with either
 *     ```tsx snippet-skip                       (fence meta; renders unchanged)
 *     ```ts snippet-skip="continues the block above"
 *   or a first line of
 *     // snippet: skip — <reason>
 *   Skipped snippets are listed on every run.
 *
 * KNOWN_FAILING below lists snippets that failed when this gate was added, in
 * pages this change did not own. They are reported on every run; one that
 * starts passing (or disappears) fails the run as stale, so the list only
 * shrinks. Fix the snippet or mark it snippet-skip — never add to the list to
 * get a run green.
 *
 * Usage:
 *   node scripts/check-doc-snippets.mjs          # exit 1 on a new failure
 *   node scripts/check-doc-snippets.mjs --keep   # keep the temp project
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, posix, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

const DOC_GLOBS = [
  { dir: 'apps/docs/content/quickstart', match: (f) => f.endsWith('.mdx') },
  ...['web', 'react', 'angular', 'vue'].map((p) => ({ dir: `packages/${p}`, match: (f) => f === 'README.md' })),
]

/**
 * Snippets that failed when the gate was added. Key: "<doc>#<n>" where n is
 * the 1-based position of the ts/tsx fence in that document; `errors` are the
 * only diagnostic codes the snippet may keep failing with.
 * @type {Map<string, { reason: string, errors: string[] }>}
 */
export const KNOWN_FAILING = new Map([
  ['apps/docs/content/quickstart/react-native.mdx#1', { reason: "<RootNavigator /> is the reader's own component", errors: ['TS2552'] }],
  ['apps/docs/content/quickstart/react.mdx#1', { reason: "imports the reader's ./App", errors: ['TS2307'] }],
  ['packages/angular/README.md#1', { reason: 'bootstrapApplication and AppComponent are used without imports', errors: ['TS2304'] }],
  ['packages/react/README.md#1', { reason: "<YourApp /> is the reader's own component", errors: ['TS2304'] }],
  [
    'packages/react/README.md#4',
    { reason: "several top-level JSX fragments; Button is the reader's own component", errors: ['TS2657', 'TS2304'] },
  ],
  ['packages/vue/README.md#1', { reason: 'App is used without an import', errors: ['TS2304'] }],
  [
    'packages/web/README.md#7',
    {
      reason:
        "real doc bugs: addBreadcrumb({ category: 'business' }) is not a category the SDK accepts and captureException has no `level` option; runCheckout is the reader's own function",
      errors: ['TS2322', 'TS2353', 'TS2304'],
    },
  ],
  ['packages/web/README.md#10', { reason: 'Mushi.init({ /* ... */ }) is a placeholder config', errors: ['TS2345'] }],
])

// Where a framework's types come from: the SDK package that depends on it.
const PREFERRED_OWNER = [
  [/^(react|react-dom|@types\/react|@types\/react-dom)$/, 'packages/react'],
  [/^(vue|@vue\/.*)$/, 'packages/vue'],
  [/^@angular\//, 'packages/angular'],
  [/^svelte$/, 'packages/svelte'],
  [/^(react-native|@react-native\/.*|@react-navigation\/.*)$/, 'packages/react-native'],
  [/^@capacitor\//, 'packages/capacitor'],
  [/^@types\/node$/, 'packages/node'],
]
// Always linked: the JSX runtime, Node's `process`, and what env.d.ts imports.
const ALWAYS = ['react', '@types/react', '@types/node', 'vue']

const ENV_DTS = `// Ambient types the documented snippets' own toolchains provide, nothing more.
// Vite: import.meta.env (the VITE_* variables the quickstarts read).
interface ImportMetaEnv {
  readonly [key: string]: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
// Vue + TypeScript projects ship this shim for single-file components.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
`

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'Preserve',
    moduleResolution: 'Bundler',
    moduleDetection: 'force',
    jsx: 'react-jsx',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    experimentalDecorators: true,
    esModuleInterop: true,
    types: ['node'],
  },
  include: ['env.d.ts', '*/**/*.ts', '*/**/*.tsx'],
}

const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})[ \t]*(ts|tsx|typescript)(?![\w-])(.*)$/

/**
 * Extract ts/tsx fences from a markdown/MDX document.
 * @returns {{ ordinal: number, line: number, lang: 'ts'|'tsx', filename: string|null, skip: string|null, code: string }[]}
 */
export function extractSnippets(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  let ordinal = 0
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE_OPEN)
    if (!open) continue
    const [, indent, fence, lang, meta] = open
    const body = []
    let j = i + 1
    for (; j < lines.length; j++) {
      const close = lines[j].match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j].trimStart())
    }
    ordinal++
    const firstCode = body.find((l) => l.trim() !== '') ?? ''
    // `filename="…"` meta (Nextra), else a first-line path comment
    // (`// app/providers.tsx`), the README convention for the same thing.
    const filename =
      meta.match(/filename=["']([^"']+)["']/)?.[1] ?? firstCode.match(/^\s*\/\/\s*([\w@./-]+\.(?:tsx?|mts))\s*$/)?.[1] ?? null
    const metaSkip = meta.match(/(?:^|\s)snippet-skip(?:=(?:"([^"]*)"|'([^']*)'))?(?=\s|$)/)
    const lineSkip = firstCode.match(/^\s*\/\/\s*snippet:\s*skip\b\s*[—–:-]?\s*(.*)$/)
    const skip = metaSkip
      ? metaSkip[1] || metaSkip[2] || 'marked snippet-skip'
      : lineSkip
        ? lineSkip[1] || 'marked snippet: skip'
        : null
    out.push({
      ordinal,
      line: i + 1,
      lang: lang === 'tsx' ? 'tsx' : 'ts',
      filename,
      skip,
      code: body.join('\n'),
    })
    i = j
  }
  return out
}

/** Bare module specifiers a snippet imports, reduced to their package name. */
export function bareImports(code) {
  const out = new Set()
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)) {
    const spec = m[1]
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue
    const parts = spec.split('/')
    out.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
  }
  return out
}

/**
 * The import statements of a snippet, verbatim. A snippet with none of its own
 * is checked with the imports of the closest earlier snippet in the same
 * document prepended: it continues that example (web README: `Mushi.init({…})`
 * blocks after the first one that imports Mushi).
 */
export function importStatements(code) {
  return [...code.matchAll(/^[ \t]*import\s(?:[^'";]*?\sfrom\s*)?['"][^'"]+['"];?/gm)].map((m) => m[0].trim())
}

/** A safe relative path for a snippet inside its document folder. */
export function snippetPath(snippet, taken) {
  const ext = `.${snippet.lang}`
  let rel = snippet.filename ? posix.normalize(snippet.filename.replace(/\\/g, '/')).replace(/^(\.\.\/|\/)+/, '') : ''
  if (rel && !/\.(ts|tsx)$/.test(rel)) rel += ext
  if (!rel || taken.has(rel)) rel = `snippet-${snippet.ordinal}${rel ? `-${posix.basename(rel)}` : ext}`
  taken.add(rel)
  return rel
}

function workspacePackages() {
  const map = new Map()
  for (const base of ['packages']) {
    for (const dir of readdirSync(join(ROOT, base))) {
      const pj = join(ROOT, base, dir, 'package.json')
      if (!existsSync(pj)) continue
      const { name } = JSON.parse(readFileSync(pj, 'utf8'))
      if (name) map.set(name, join(ROOT, base, dir))
    }
  }
  return map
}

function findDependency(spec) {
  const owners = PREFERRED_OWNER.filter(([re]) => re.test(spec)).map(([, dir]) => dir)
  const fallbacks = [
    ...readdirSync(join(ROOT, 'packages')).map((d) => `packages/${d}`),
    ...readdirSync(join(ROOT, 'apps')).map((d) => `apps/${d}`),
  ]
  for (const dir of [...owners, ...fallbacks]) {
    const candidate = join(ROOT, dir, 'node_modules', ...spec.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
  }
  return null
}

function link(nodeModules, spec, target, links) {
  const dest = join(nodeModules, ...spec.split('/'))
  mkdirSync(dirname(dest), { recursive: true })
  symlinkSync(target, dest, 'junction')
  links.push(dest)
}

function docFolder(doc) {
  return doc.replace(/\.(mdx?|md)$/, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')
}

function listDocs() {
  const docs = []
  for (const { dir, match } of DOC_GLOBS) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const f of readdirSync(abs).sort()) if (match(f)) docs.push(`${dir}/${f}`)
  }
  return docs
}

function main() {
  const keep = process.argv.includes('--keep')
  const docs = listDocs()
  const workspace = workspacePackages()
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'mushi-doc-snippets-')))
  const links = []
  /** @type {Map<string, { doc: string, snippet: ReturnType<typeof extractSnippets>[number], preludeLines: number }>} */
  const byFile = new Map()
  const skipped = []
  const specs = new Set(ALWAYS)

  try {
    for (const doc of docs) {
      const folder = docFolder(doc)
      const taken = new Set()
      let inherited = []
      for (const snippet of extractSnippets(readFileSync(join(ROOT, doc), 'utf8'))) {
        if (snippet.skip) {
          skipped.push(`${doc}#${snippet.ordinal} (line ${snippet.line}): ${snippet.skip}`)
          continue
        }
        const own = importStatements(snippet.code)
        if (own.length > 0) inherited = own
        const prelude = own.length === 0 && inherited.length > 0 ? `${inherited.join('\n')}\n` : ''
        const rel = `${folder}/${snippetPath(snippet, taken)}`
        mkdirSync(dirname(join(tmp, rel)), { recursive: true })
        writeFileSync(join(tmp, rel), `${prelude}${snippet.code}\n`)
        byFile.set(rel, { doc, snippet, preludeLines: prelude ? prelude.split('\n').length - 1 : 0 })
        for (const s of bareImports(snippet.code)) specs.add(s)
      }
    }

    const nodeModules = join(tmp, 'node_modules')
    const unresolved = []
    for (const spec of [...specs].sort()) {
      const ws = workspace.get(spec)
      if (ws) {
        const pkg = JSON.parse(readFileSync(join(ws, 'package.json'), 'utf8'))
        const types = pkg.types ?? pkg.typings
        if (types && !existsSync(join(ws, types))) {
          console.error(`check-doc-snippets: ${spec} is not built (${types} missing). Run \`pnpm build\` first.`)
          return 2
        }
        link(nodeModules, spec, ws, links)
        continue
      }
      const found = findDependency(spec)
      if (found) link(nodeModules, spec, found, links)
      else unresolved.push(spec)
      if (!spec.startsWith('@types/')) {
        const typesName = `@types/${spec.startsWith('@') ? spec.slice(1).replace('/', '__') : spec}`
        if (!specs.has(typesName)) {
          const typesPkg = findDependency(typesName)
          if (typesPkg) link(nodeModules, typesName, typesPkg, links)
        }
      }
    }
    writeFileSync(join(tmp, 'env.d.ts'), ENV_DTS)
    writeFileSync(join(tmp, 'tsconfig.json'), `${JSON.stringify(TSCONFIG, null, 2)}\n`)

    // The compiler API rather than the tsc CLI: tsc stops at syntax errors and
    // never reports the semantic errors of the other snippets in that run.
    const ts = createRequire(join(ROOT, 'packages/web/package.json'))('typescript')
    const configErrors = []
    const parsed = ts.getParsedCommandLineOfConfigFile(join(tmp, 'tsconfig.json'), undefined, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => configErrors.push(d),
    })
    const program = ts.createProgram({ rootNames: parsed?.fileNames ?? [], options: parsed?.options ?? {} })
    const diagnostics = [...configErrors, ...(parsed?.errors ?? []), ...ts.getPreEmitDiagnostics(program)].filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    )

    /** @type {Map<string, string[]>} */
    const errorsByKey = new Map()
    const stray = []
    for (const d of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(d.messageText, ' ')
      const file = d.file ? relative(tmp, d.file.fileName).replace(/\\/g, '/') : null
      const hit = file ? byFile.get(file) : undefined
      if (!hit || d.start === undefined) {
        stray.push(`${file ?? '(no file)'}: TS${d.code} ${message}`)
        continue
      }
      const key = `${hit.doc}#${hit.snippet.ordinal}`
      const codeLine = d.file.getLineAndCharacterOfPosition(d.start).line - hit.preludeLines
      const docLine = hit.snippet.line + 1 + Math.max(codeLine, 0)
      const list = errorsByKey.get(key) ?? []
      list.push(`${hit.doc}:${docLine} TS${d.code} ${message}`)
      errorsByKey.set(key, list)
    }

    const failures = []
    const known = []
    const allKeys = new Set([...byFile.values()].map(({ doc, snippet }) => `${doc}#${snippet.ordinal}`))
    for (const [key, errs] of errorsByKey) {
      const entry = KNOWN_FAILING.get(key)
      if (!entry) {
        failures.push(`${key}\n      ${errs.join('\n      ')}`)
        continue
      }
      // A known-failing snippet may only fail the way it was recorded; any
      // other error in it is a new problem the baseline must not hide.
      const unexpected = errs.filter((e) => !entry.errors.some((code) => e.includes(` ${code} `)))
      if (unexpected.length > 0) failures.push(`${key} (known failing) has new errors\n      ${unexpected.join('\n      ')}`)
      else known.push(`${key} — ${entry.reason}\n      ${errs.join('\n      ')}`)
    }
    for (const [key] of KNOWN_FAILING) {
      if (!allKeys.has(key)) failures.push(`${key} is listed in KNOWN_FAILING but no longer exists (or is marked skip) — remove the entry`)
      else if (!errorsByKey.has(key)) failures.push(`${key} passes now — remove it from KNOWN_FAILING`)
    }

    for (const s of skipped) console.log(`skip   ${s}`)
    for (const k of known) console.warn(`KNOWN  ${k}`)
    if (unresolved.length) console.warn(`note: no workspace copy of ${unresolved.join(', ')}; imports of it fail with TS2307`)

    if (stray.length > 0) {
      console.error('check-doc-snippets: tsc reported errors outside the snippets (setup problem):')
      for (const s of stray.slice(0, 20)) console.error(`  ${s}`)
      return 2
    }
    const passed = byFile.size - errorsByKey.size
    if (failures.length > 0) {
      console.error(`\ncheck-doc-snippets: ${failures.length} snippet problem(s):\n`)
      for (const f of failures) console.error(`  ✗ ${f}`)
      console.error(
        '\nFix the snippet, or — if it is deliberately partial — mark its fence `snippet-skip` (see the header of scripts/check-doc-snippets.mjs).',
      )
      return 1
    }
    console.log(
      `check-doc-snippets: ${passed} of ${byFile.size} snippet(s) in ${docs.length} document(s) type-check ✓ ` +
        `(${known.length} known failing, ${skipped.length} skipped — listed above)`,
    )
    return 0
  } finally {
    if (keep) console.log(`temp project kept at ${tmp}`)
    else {
      for (const l of links) {
        try {
          unlinkSync(l)
        } catch {
          // already gone
        }
      }
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

function isEntryScript() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (isEntryScript()) process.exitCode = main()
