/**
 * FILE: scripts/viz-token-emission.mjs
 * PURPOSE: Fail when a viz colour read from admin JS is missing from the
 *          compiled theme. Tailwind v4 drops @theme colours that no utility
 *          uses; readVizToken() reads them with getComputedStyle, so they
 *          have to be declared in @theme static.
 *
 *          Also fails when readVizToken() runs at module scope. main.tsx
 *          imports the app graph before index.css, so that call freezes the
 *          stand-in colour for the rest of the page.
 *
 * USAGE:
 *   Imported by scripts/check-design-tokens.mjs.
 *   node --test scripts/viz-token-emission.test.mjs
 *
 * DEPENDENCIES:
 *   @tailwindcss/node — direct devDependency of apps/admin, same range as
 *   tailwindcss. Resolved from apps/admin/package.json, not through
 *   @tailwindcss/vite's nested tree.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '..')

export function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Quoted viz-* token names in one TS source string, comments excluded. */
export function vizTokenNamesInSource(src) {
  const names = new Set()
  for (const match of stripJsComments(src).matchAll(/(['"`])(viz-[a-z0-9-]+)\1/g)) {
    names.add(match[2])
  }
  return [...names].sort()
}

export function walkTsSources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) walkTsSources(path, acc)
    else if (/\.tsx?$/.test(entry)) acc.push(path)
  }
  return acc
}

export function vizTokenNamesInAdmin(adminSrc = resolve(REPO_ROOT, 'apps/admin/src')) {
  const names = new Set()
  for (const file of walkTsSources(adminSrc)) {
    for (const name of vizTokenNamesInSource(readFileSync(file, 'utf8'))) names.add(name)
  }
  return [...names].sort()
}

/** Names whose `--color-<name>:` declaration is absent from compiled CSS. */
export function vizTokensMissingFromCss(names, css) {
  return names.filter((name) => !css.includes(`--color-${name}:`))
}

const TAILWIND_NODE_MISSING = [
  'Cannot resolve @tailwindcss/node from apps/admin/package.json.',
  'It is a direct devDependency of @mushi-mushi/admin, on the same range as tailwindcss and @tailwindcss/vite.',
  'Install workspace dependencies from the repo root (pnpm install).',
  'This check does not walk @tailwindcss/vite\'s dependency tree; that path depends on pnpm\'s layout.',
].join(' ')

function resolveFromAdmin(spec) {
  const fromAdmin = createRequire(resolve(REPO_ROOT, 'apps/admin/package.json'))
  return fromAdmin.resolve(spec)
}

/** Absolute entry of @tailwindcss/node, as declared by the admin package. */
export function resolveTailwindNodeEntry(resolveSpec = resolveFromAdmin) {
  try {
    return resolveSpec('@tailwindcss/node')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const error = new Error(`${TAILWIND_NODE_MISSING}\n${detail}`)
    error.cause = err
    throw error
  }
}

/**
 * Compile a Tailwind v4 stylesheet with no utility candidates.
 * `base` must be a directory whose node_modules can resolve `tailwindcss`
 * (the admin package).
 */
export async function compileThemeCss(css, base) {
  const { compile } = await import(resolveTailwindNodeEntry())
  const compiler = await compile(css, {
    base,
    onDependency() {},
  })
  return compiler.build([])
}

let typescriptModule

function loadTypescript() {
  if (!typescriptModule) {
    const fromAdmin = createRequire(resolve(REPO_ROOT, 'apps/admin/package.json'))
    typescriptModule = fromAdmin('typescript')
  }
  return typescriptModule
}

function runsAtModuleInit(ts, node) {
  let parent = node.parent
  while (parent) {
    if (ts.isFunctionLike(parent)) return false
    if (
      ts.isPropertyDeclaration(parent) &&
      parent.parent &&
      (ts.isClassDeclaration(parent.parent) || ts.isClassExpression(parent.parent))
    ) {
      const isStatic = parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
      if (!isStatic) return false
    }
    parent = parent.parent
  }
  return true
}

/**
 * `readVizToken()` calls evaluated while the module is loading.
 * Calls inside functions, getters, and instance fields are paint-time.
 */
export function moduleScopeReadVizTokenCalls(filename, src) {
  const ts = loadTypescript()
  const kind = filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, kind)
  const hits = []
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'readVizToken') {
      if (runsAtModuleInit(ts, node)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        hits.push({ file: filename, line: line + 1 })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return hits
}

/** Module-scope readVizToken() calls under apps/admin/src. Paths are repo-relative. */
export function moduleScopeReadVizTokenHits(adminSrc = resolve(REPO_ROOT, 'apps/admin/src')) {
  const hits = []
  for (const file of walkTsSources(adminSrc)) {
    const src = readFileSync(file, 'utf8')
    if (!src.includes('readVizToken')) continue
    const repoFile = relative(REPO_ROOT, file)
    for (const hit of moduleScopeReadVizTokenCalls(file, src)) {
      hits.push({ file: repoFile, line: hit.line })
    }
  }
  return hits
}

/** Compile theme-tokens.css alone, so a token kept only by a utility class is absent. */
export async function compileAdminThemeTokens() {
  const themePath = resolve(REPO_ROOT, 'apps/admin/src/styles/theme-tokens.css')
  const css = `@import "tailwindcss" source(none);\n${readFileSync(themePath, 'utf8')}`
  return compileThemeCss(css, resolve(REPO_ROOT, 'apps/admin'))
}

export async function missingEmittedVizTokens() {
  const css = await compileAdminThemeTokens()
  return vizTokensMissingFromCss(vizTokenNamesInAdmin(), css)
}
