/**
 * FILE: scripts/viz-token-emission.mjs
 * PURPOSE: Fail when a viz colour read from admin JS is missing from the
 *          compiled theme. Tailwind v4 drops @theme colours that no utility
 *          uses; readVizToken() reads them with getComputedStyle, so they
 *          have to be declared in @theme static.
 *
 *          A viz-* string counts only when it is an argument of readVizToken()
 *          or a value passed to vizColorMap(), including a local binding those
 *          calls read (a status map, or a property on a mapped row). A test id
 *          or class fragment does not.
 *
 *          Also fails when readVizToken() runs at module scope. main.tsx
 *          imports the app graph before index.css, so that call freezes the
 *          stand-in colour for the rest of the page.
 *
 *          check-design-tokens.mjs --pre-commit skips the TypeScript scan and
 *          the Tailwind compile unless a staged path is admin CSS, admin
 *          source, or one of these scripts. CI runs the check every time.
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

const VIZ_NAME = /^viz-[a-z0-9-]+$/

function unwrapExpr(ts, expr) {
  while (expr) {
    if (
      ts.isParenthesizedExpression(expr) ||
      ts.isAsExpression(expr) ||
      ts.isNonNullExpression(expr) ||
      (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(expr)) ||
      (typeof ts.isTypeAssertionExpression === 'function' && ts.isTypeAssertionExpression(expr))
    ) {
      expr = expr.expression
      continue
    }
    break
  }
  return expr
}

function propertyNameText(ts, name) {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text
  }
  return null
}

/** Nearest variable or parameter binding for `ident`. */
function resolveBinding(ts, ident) {
  const name = ident.text
  let current = ident.parent
  while (current) {
    if (current.statements) {
      for (const stmt of current.statements) {
        if (!ts.isVariableStatement(stmt)) continue
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === name) return decl
        }
      }
    }
    if (ts.isFunctionLike(current)) {
      for (const param of current.parameters) {
        if (ts.isIdentifier(param.name) && param.name.text === name) return param
      }
    }
    current = current.parent
  }
  return null
}

/**
 * viz-* names that readVizToken() or vizColorMap() actually read in one file.
 * Other quoted viz-* strings (test ids, class fragments) are ignored.
 */
export function vizTokenNamesInSource(src, filename = 'sample.tsx') {
  if (!src.includes('readVizToken') && !src.includes('vizColorMap')) return []
  const ts = loadTypescript()
  const kind = filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, kind)
  const names = new Set()
  const seen = new Set()

  function addName(text) {
    if (VIZ_NAME.test(text)) names.add(text)
  }

  function collectTokenExpr(expr) {
    expr = unwrapExpr(ts, expr)
    if (!expr) return
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      addName(expr.text)
      return
    }
    if (ts.isIdentifier(expr)) {
      collectAllFromBinding(expr)
      return
    }
    if (ts.isPropertyAccessExpression(expr)) {
      const base = unwrapExpr(ts, expr.expression)
      if (ts.isIdentifier(base)) collectPropertyRead(base, expr.name.text)
      else collectTokenExpr(base)
      return
    }
    if (ts.isElementAccessExpression(expr)) {
      const base = unwrapExpr(ts, expr.expression)
      if (ts.isIdentifier(base)) collectAllFromBinding(base)
      else collectTokenExpr(base)
      return
    }
    ts.forEachChild(expr, (child) => {
      if (ts.isIdentifier(child)) return
      collectTokenExpr(child)
    })
  }

  function collectAllFromBinding(ident) {
    const decl = resolveBinding(ts, ident)
    if (!decl || seen.has(decl)) return
    seen.add(decl)
    if (ts.isVariableDeclaration(decl) && decl.initializer) collectTokenExpr(decl.initializer)
  }

  function collectPropertyRead(ident, propName) {
    const decl = resolveBinding(ts, ident)
    if (!decl || seen.has(decl)) return
    seen.add(decl)
    if (ts.isParameter(decl)) {
      const receiver = mappedReceiver(decl)
      if (receiver) collectNamedPropValues(receiver, propName)
      return
    }
    if (ts.isVariableDeclaration(decl) && decl.initializer) collectNamedPropValues(decl.initializer, propName)
  }

  function mappedReceiver(paramDecl) {
    const fn = paramDecl.parent
    if (!fn || !ts.isFunctionLike(fn)) return null
    const call = fn.parent
    if (!call || !ts.isCallExpression(call) || !call.arguments.includes(fn)) return null
    const callee = unwrapExpr(ts, call.expression)
    if (!ts.isPropertyAccessExpression(callee)) return null
    if (callee.name.text !== 'map' && callee.name.text !== 'flatMap' && callee.name.text !== 'forEach') return null
    return callee.expression
  }

  function collectNamedPropValues(expr, propName) {
    expr = unwrapExpr(ts, expr)
    if (!expr) return
    if (ts.isIdentifier(expr)) {
      const decl = resolveBinding(ts, expr)
      if (!decl || seen.has(decl)) return
      seen.add(decl)
      if (ts.isVariableDeclaration(decl) && decl.initializer) collectNamedPropValues(decl.initializer, propName)
      return
    }
    if (ts.isArrayLiteralExpression(expr)) {
      for (const el of expr.elements) collectNamedPropValues(el, propName)
      return
    }
    if (!ts.isObjectLiteralExpression(expr)) return
    for (const prop of expr.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      if (propertyNameText(ts, prop.name) === propName) collectTokenExpr(prop.initializer)
    }
  }

  function collectVizColorMapArg(arg) {
    const expr = unwrapExpr(ts, arg)
    if (!expr) return
    if (!ts.isObjectLiteralExpression(expr)) {
      collectTokenExpr(expr)
      return
    }
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) collectTokenExpr(prop.initializer)
      else if (ts.isShorthandPropertyAssignment(prop)) collectTokenExpr(prop.name)
    }
  }

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'readVizToken' && node.arguments[0]) collectTokenExpr(node.arguments[0])
      else if (node.expression.text === 'vizColorMap' && node.arguments[0]) collectVizColorMapArg(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...names].sort()
}

/**
 * Paths that can change which viz tokens the stylesheet emits or which names
 * admin source reads. A pre-commit that touches none of these skips the
 * TypeScript scan and the Tailwind compile.
 */
export function isVizEmissionSource(file) {
  const path = String(file).replaceAll('\\', '/')
  if (path === 'scripts/viz-token-emission.mjs' || path === 'scripts/check-design-tokens.mjs') return true
  if (/^apps\/admin\/.*\.css$/.test(path)) return true
  if (/^apps\/admin\/src\/.*\.tsx?$/.test(path)) return true
  return false
}

export function vizEmissionSourcesChanged(paths) {
  return paths.some((file) => isVizEmissionSource(file))
}

/**
 * CI and a plain `node scripts/check-design-tokens.mjs` always compile.
 * `--pre-commit` compiles only when a staged path is a viz source.
 * `changedPaths === null` means the path list is unknown, so the check runs.
 */
export function shouldRunVizEmissionCheck({ preCommit, changedPaths }) {
  if (!preCommit) return true
  if (!changedPaths) return true
  return vizEmissionSourcesChanged(changedPaths)
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
    for (const name of vizTokenNamesInSource(readFileSync(file, 'utf8'), file)) names.add(name)
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
