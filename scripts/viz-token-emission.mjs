/**
 * FILE: scripts/viz-token-emission.mjs
 * PURPOSE: Fail when a viz colour read from admin JS is missing from the
 *          compiled theme. Tailwind v4 drops @theme colours that no utility
 *          uses; readVizToken() reads them with getComputedStyle, so they
 *          have to be declared in @theme static.
 *
 * USAGE:
 *   Imported by scripts/check-design-tokens.mjs.
 *   node --test scripts/viz-token-emission.test.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
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

/**
 * Compile a Tailwind v4 stylesheet with no utility candidates.
 * `base` must be a directory whose node_modules can resolve `tailwindcss`
 * (the admin package).
 */
export async function compileThemeCss(css, base) {
  // @tailwindcss/node is not a direct admin dependency. The Vite plugin
  // depends on it, and pnpm only exposes that to the plugin.
  const fromAdmin = createRequire(resolve(REPO_ROOT, 'apps/admin/package.json'))
  const fromVite = createRequire(fromAdmin.resolve('@tailwindcss/vite'))
  const { compile } = await import(fromVite.resolve('@tailwindcss/node'))
  const compiler = await compile(css, {
    base,
    onDependency() {},
  })
  return compiler.build([])
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
