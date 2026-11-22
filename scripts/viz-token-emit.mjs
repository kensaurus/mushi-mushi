/**
 * FILE: scripts/viz-token-emit.mjs
 * PURPOSE: Tailwind v4 drops `@theme` colours that no utility class uses.
 *          Chart colours are read at runtime (`readVizToken` → getComputedStyle),
 *          so they must live in `@theme static` or they never reach the CSS.
 *          A call at module scope also runs before main.tsx imports index.css
 *          and freezes the stand-in colour. Both are checked here.
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const THEME_ENTRY = `@import "tailwindcss" source(none);\n@import "./theme-tokens.css";\n`

/** A `@theme` colour that is not static. If a no-utility compile still emits it, tree-shaking did not run and the check cannot tell static tokens apart. */
const TREE_SHAKE_SENTINEL = '--color-rose:'

let typescriptMod = null
let compileMod = null

function typescript() {
  if (!typescriptMod) {
    const require = createRequire(resolve(ROOT, 'apps/admin/package.json'))
    typescriptMod = require('typescript')
  }
  return typescriptMod
}

function packageRoot(entryPath, name) {
  let dir = dirname(entryPath)
  for (let i = 0; i < 6; i++) {
    const pkgPath = resolve(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (pkg.name === name) return dir
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Could not find the ${name} package from ${entryPath}`)
}

async function loadCompile() {
  if (!compileMod) {
    const requireAdmin = createRequire(resolve(ROOT, 'apps/admin/package.json'))
    const viteEntry = requireAdmin.resolve('@tailwindcss/vite')
    const fromVite = createRequire(resolve(packageRoot(viteEntry, '@tailwindcss/vite'), 'package.json'))
    const entry = fromVite.resolve('@tailwindcss/node')
    compileMod = await import(pathToFileURL(entry).href)
  }
  return compileMod
}

/**
 * Compile CSS with Tailwind and no utility candidates.
 * @param {string} css
 * @param {string} base directory used to resolve `@import`
 */
export async function compileCss(css, base) {
  const { compile } = await loadCompile()
  const compiler = await compile(css, {
    base,
    onDependency() {},
  })
  return compiler.build([])
}

/** Admin theme as Tailwind emits it when nothing generates a utility. */
export async function compileThemeWithoutUtilities() {
  return compileCss(THEME_ENTRY, resolve(ROOT, 'apps/admin/src/styles'))
}

function scriptKind(fileName) {
  const ts = typescript()
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function sourceFile(src, fileName) {
  const ts = typescript()
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, scriptKind(fileName))
}

function isInstanceField(node) {
  const ts = typescript()
  if (!ts.isPropertyDeclaration(node)) return false
  return !node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
}

/**
 * `readVizToken()` calls that run while the module is evaluated.
 * Safe inside functions, getters, methods, arrows, and instance fields.
 * @param {string} src
 * @param {string} fileName
 * @returns {{ line: number, snippet: string }[]}
 */
export function moduleScopeReadVizTokenCalls(src, fileName = 'file.ts') {
  const ts = typescript()
  const sf = sourceFile(src, fileName)
  const hits = []

  function visit(node, deferred) {
    if (
      !deferred &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'readVizToken'
    ) {
      const pos = node.getStart(sf)
      const { line } = sf.getLineAndCharacterOfPosition(pos)
      const snippet = node.getText(sf).replace(/\s+/g, ' ').slice(0, 140)
      hits.push({ line: line + 1, snippet })
    }
    const childDeferred = deferred || ts.isFunctionLike(node) || isInstanceField(node)
    ts.forEachChild(node, (child) => visit(child, childDeferred))
  }

  visit(sf, false)
  return hits
}

/**
 * `viz-*` string literals in a file that calls `readVizToken`.
 * @param {string} src
 * @param {string} fileName
 * @returns {string[]}
 */
export function vizTokenNamesInSource(src, fileName = 'file.ts') {
  const ts = typescript()
  const sf = sourceFile(src, fileName)
  const names = new Set()
  let uses = false

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'readVizToken'
    ) {
      uses = true
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /^viz-[a-z0-9-]+$/.test(node.text)
    ) {
      names.add(node.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return uses ? [...names] : []
}

function isProductionSource(file) {
  if (!/\.tsx?$/.test(file)) return false
  if (file.endsWith('.d.ts')) return false
  if (/\.(?:test|spec)\.tsx?$/.test(file)) return false
  return true
}

/**
 * @param {string} root
 * @param {string[]} files absolute paths
 * @returns {Promise<string[]>} problems, empty when the theme is the one source
 */
export async function findVizEmitProblems(root, files) {
  const problems = []
  const names = new Set()

  for (const file of files) {
    if (!isProductionSource(file)) continue
    const src = readFileSync(file, 'utf8')
    if (!src.includes('readVizToken')) continue
    const rel = relative(root, file).replace(/\\/g, '/')
    for (const hit of moduleScopeReadVizTokenCalls(src, file)) {
      problems.push(
        `${rel}:${hit.line}  readVizToken() runs at import, before index.css — read it in a function or getter (${hit.snippet})`,
      )
    }
    for (const name of vizTokenNamesInSource(src, file)) names.add(name)
  }

  let css = ''
  try {
    css = await compileThemeWithoutUtilities()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    problems.push(`could not compile the admin theme with no utilities: ${message}`)
    return problems
  }

  if (css.includes(TREE_SHAKE_SENTINEL)) {
    problems.push(
      'no-utility theme compile still emitted --color-rose, so unused @theme colours were not tree-shaken and this check cannot tell a static token from an ordinary one',
    )
  }

  for (const name of [...names].sort()) {
    if (!css.includes(`--color-${name}:`)) {
      problems.push(
        `--color-${name} is read via readVizToken() but missing from the theme compiled with no utilities (put it in @theme static)`,
      )
    }
  }

  return problems
}
