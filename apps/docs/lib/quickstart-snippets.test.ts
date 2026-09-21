/**
 * Compile every TypeScript sample on the web-framework quickstart pages
 * against the SDK *sources* in packages/, with strict TypeScript.
 *
 * Why: in September 2026 four documented snippets failed `tsc` against the
 * published packages — `mushi.submitReport` on a value the page never
 * exported, `const { submit } = useMushiReport()` on a hook that returns a
 * function, and an Angular `provideMushi()` that is not a provider. Nothing
 * in CI read the docs as code. This test does, so renaming an export breaks
 * the build here instead of breaking a reader's first install.
 *
 * How: each page's blocks become virtual files under packages/<pkg>/ (so bare
 * imports such as `react`, `vue` and `@angular/core` resolve from that
 * package's own node_modules), `@mushi-mushi/*` is mapped to
 * packages/<name>/src/index.ts (no build needed), and only diagnostics that
 * point into a snippet file are reported. A `filename="…"` on the fence
 * becomes the virtual path, so a snippet that imports `./mushi` finds the
 * block written as `src/mushi.ts`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

// ─── Fenced-block extraction (used only by this test) ───────────────────────

interface CodeBlock {
  /** Info-string language, lower-cased (`ts`, `tsx`, `bash`, …); '' when absent. */
  lang: string
  /** Value of a `filename="…"` attribute on the fence, when present. */
  filename: string | null
  code: string
  /** 1-based line of the opening fence, for error messages. */
  line: number
}

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)(.*)$/
const FILENAME_ATTR = /filename=(?:"([^"]+)"|'([^']+)')/

/**
 * Every fenced block in `mdx`, in order. A fence closes only on the same
 * character repeated at least as many times (CommonMark), so a four-backtick
 * block may contain triple-backtick lines. An unclosed fence runs to the end.
 */
function extractCodeBlocks(mdx: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  const lines = mdx.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i] ?? '')
    if (!open) {
      i++
      continue
    }
    const fence = open[1] ?? '```'
    const attr = FILENAME_ATTR.exec(open[3] ?? '')
    const start = i
    const body: string[] = []
    i++
    while (i < lines.length) {
      const text = lines[i] ?? ''
      const trimmed = text.trim()
      if (trimmed.length >= fence.length && trimmed === fence[0]!.repeat(trimmed.length)) break
      body.push(text)
      i++
    }
    blocks.push({
      lang: (open[2] ?? '').toLowerCase(),
      filename: attr ? (attr[1] ?? attr[2] ?? null) : null,
      code: body.join('\n'),
      line: start + 1,
    })
    i++ // skip the closing fence
  }
  return blocks
}

/** True for blocks the TypeScript compiler should check. */
function isTypeScriptBlock(block: CodeBlock): boolean {
  return block.lang === 'ts' || block.lang === 'tsx' || block.lang === 'typescript'
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONTENT = join(__dirname, '..', 'content')
const PACKAGES = resolve(__dirname, '..', '..', '..', 'packages')

interface SnippetPage {
  /** Page under apps/docs/content. */
  page: string
  /** packages/<pkgDir> whose node_modules the snippets resolve against. */
  pkgDir: string
  /** Extra virtual files the samples import but do not show (the reader's own app code). */
  fixtures?: Record<string, string>
}

/** Stand-in for Vite's `vite/client` types — the quickstarts read `import.meta.env`. */
const VITE_ENV_DTS = `interface ImportMetaEnv { readonly [key: string]: string }
interface ImportMeta { readonly env: ImportMetaEnv }
`

const PAGES: readonly SnippetPage[] = [
  { page: 'quickstart/web.mdx', pkgDir: 'web' },
  {
    page: 'quickstart/react.mdx',
    pkgDir: 'react',
    fixtures: { 'src/App.tsx': 'export function App() {\n  return null\n}\n' },
  },
  { page: 'quickstart/angular.mdx', pkgDir: 'angular' },
  {
    page: 'quickstart/vue.mdx',
    pkgDir: 'vue',
    fixtures: {
      'src/shims-vue.d.ts':
        "declare module '*.vue' {\n  const component: import('vue').Component\n  export default component\n}\n",
    },
  },
  { page: 'quickstart/svelte.mdx', pkgDir: 'svelte' },
]

const toKey = (p: string) => resolve(p).replace(/\\/g, '/').toLowerCase()

interface VirtualFile {
  path: string
  text: string
  /** Where the text came from, for failure messages. */
  origin: string
  isSnippet: boolean
}

function virtualFilesFor(spec: SnippetPage): VirtualFile[] {
  const root = join(PACKAGES, spec.pkgDir, '.docs-snippets', spec.page.replace(/\.mdx$/, ''))
  const blocks = extractCodeBlocks(readFileSync(join(CONTENT, spec.page), 'utf8')).filter(isTypeScriptBlock)
  const files: VirtualFile[] = blocks.map((block, i) => ({
    path: join(root, block.filename ?? `src/snippet-${i + 1}.${block.lang === 'tsx' ? 'tsx' : 'ts'}`),
    text: block.code,
    origin: `${spec.page}:${block.line}`,
    isSnippet: true,
  }))
  for (const [rel, text] of Object.entries(spec.fixtures ?? {})) {
    files.push({ path: join(root, rel), text, origin: `fixture ${rel}`, isSnippet: false })
  }
  files.push({ path: join(root, 'vite-env.d.ts'), text: VITE_ENV_DTS, origin: 'vite-env.d.ts', isSnippet: false })
  return files
}

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  experimentalDecorators: true,
  types: [],
  paths: { '@mushi-mushi/*': [join(PACKAGES, '*', 'src', 'index.ts').replace(/\\/g, '/')] },
}

/** One program for every page; returns the formatted errors per page. */
function compileSnippets(pages: readonly SnippetPage[]): Map<string, string[]> {
  const perPage = pages.map((spec) => ({ spec, files: virtualFilesFor(spec) }))
  const virtual = new Map<string, VirtualFile>()
  for (const { files } of perPage) for (const f of files) virtual.set(toKey(f.path), f)
  const virtualDirs = new Set<string>()
  for (const key of virtual.keys()) {
    let dir = key
    while (dir.includes('/')) {
      dir = dir.slice(0, dir.lastIndexOf('/'))
      virtualDirs.add(dir)
    }
  }

  const host = ts.createCompilerHost(options)
  const base = {
    fileExists: host.fileExists.bind(host),
    readFile: host.readFile.bind(host),
    getSourceFile: host.getSourceFile.bind(host),
    directoryExists: host.directoryExists?.bind(host),
  }
  host.fileExists = (f) => virtual.has(toKey(f)) || base.fileExists(f)
  host.readFile = (f) => virtual.get(toKey(f))?.text ?? base.readFile(f)
  host.directoryExists = (d) => virtualDirs.has(toKey(d)) || (base.directoryExists ? base.directoryExists(d) : true)
  host.getSourceFile = (f, languageVersion, onError, shouldCreate) => {
    const v = virtual.get(toKey(f))
    return v ? ts.createSourceFile(f, v.text, languageVersion, true) : base.getSourceFile(f, languageVersion, onError, shouldCreate)
  }

  const program = ts.createProgram({
    rootNames: [...virtual.values()].map((f) => f.path),
    options,
    host,
  })

  const result = new Map<string, string[]>()
  for (const { spec, files } of perPage) {
    const errors: string[] = []
    for (const file of files.filter((f) => f.isSnippet)) {
      const sf = program.getSourceFile(file.path)
      if (!sf) {
        errors.push(`${file.origin}: snippet was not part of the program`)
        continue
      }
      for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
        const where = d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : 0
        errors.push(`${file.origin} (+${where}): TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
      }
    }
    result.set(spec.page, errors)
  }
  return result
}

describe('quickstart code samples compile against the SDK sources', () => {
  let results = new Map<string, string[]>()

  // One program type-checks the SDK sources once for every page (~10-20 s).
  beforeAll(() => {
    results = compileSnippets(PAGES)
  }, 180_000)

  for (const spec of PAGES) {
    it(`${spec.page} has TypeScript samples and they type-check`, () => {
      expect(virtualFilesFor(spec).some((f) => f.isSnippet), `${spec.page} lost its TypeScript samples`).toBe(true)
      expect(results.get(spec.page)).toEqual([])
    })
  }
})
