// scripts/marketing/lib.mjs
//
// Shared helpers for the marketing-automation toolkit. Zero runtime deps —
// follows the same convention as the rest of scripts/ in this repo so a
// fresh `pnpm install` is never required to run a marketing task.
//
// What lives here:
//   - loadEnv()          parses .env.local into process.env (no dotenv dep)
//   - need(key)          assertive env getter with a friendly error
//   - log / ok / warn / err  styled console helpers (ANSI, no chalk dep)
//   - argv               trivial flag parser ({ dry: bool, slug: string, ... })
//   - sleep, jitter      tiny rate-limit helpers used by the Bluesky / awesome-PR scripts
//   - gh()               wrapper around `gh` CLI that surfaces stderr cleanly
//
// All scripts in scripts/marketing/ import from here so a behaviour change
// (e.g. adding a global --verbose flag) lands in one place.

import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '..', '..')

// --- env -----------------------------------------------------------------

// Loads .env.local then .env into process.env. Existing process.env values
// always win so CI overrides keep priority. Returns an object describing
// which files were applied so callers can surface it on --verbose.
export function loadEnv() {
  const applied = []
  for (const file of ['.env.local', '.env']) {
    const path = resolve(REPO_ROOT, file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = value
      }
    }
    applied.push(file)
  }
  return { applied }
}

export function need(key, hint) {
  const v = process.env[key]
  if (!v) {
    err(`Missing env var ${key}.${hint ? ' ' + hint : ''}`)
    process.exit(1)
  }
  return v
}

export function maybe(key) {
  const v = process.env[key]
  return v && v.length > 0 ? v : null
}

// --- console -------------------------------------------------------------

const isTTY = process.stdout.isTTY && !process.env.NO_COLOR
const c = (code, s) => (isTTY ? `\u001b[${code}m${s}\u001b[0m` : s)
const dim = (s) => c('2', s)
const bold = (s) => c('1', s)
const green = (s) => c('32', s)
const yellow = (s) => c('33', s)
const red = (s) => c('31', s)
const cyan = (s) => c('36', s)

export function log(...args) {
  console.log(...args)
}
export function step(label) {
  console.log(bold(cyan('→')), label)
}
export function ok(label) {
  console.log(green('✓'), label)
}
export function warn(label) {
  console.warn(yellow('!'), label)
}
export function err(label) {
  console.error(red('✗'), label)
}
export function dimLog(label) {
  console.log(dim(label))
}

// --- argv ----------------------------------------------------------------

// Tiny zero-dep parser. Supports `--flag`, `--key value`, `--key=value`,
// and positional arguments returned under `_`. Boolean flags default true.
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [], dry: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2)
      const next = argv[i + 1]
      let value
      if (eq > 0) value = a.slice(eq + 1)
      else if (next && !next.startsWith('--')) {
        value = next
        i++
      } else {
        value = true
      }
      out[key] = value
    } else {
      out._.push(a)
    }
  }
  return out
}

// --- timing --------------------------------------------------------------

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const jitter = (base) => sleep(base + Math.floor(Math.random() * 250))

// --- gh CLI --------------------------------------------------------------

// Runs `gh` synchronously, returns trimmed stdout, throws on non-zero exit.
// The synchronous path is fine for these one-shot marketing scripts and
// keeps error reporting trivial.
export function gh(args, { input } = {}) {
  // shell:false so each arg is passed verbatim — critical on Windows where
  // shell:true joins+reparses through cmd.exe and shreds quoted strings
  // that contain spaces / commas / colons (e.g. an About description).
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  if (result.error) {
    err(`gh CLI not found on PATH. Install: https://cli.github.com/`)
    throw result.error
  }
  if (result.status !== 0) {
    err(`gh ${args.join(' ')} → exit ${result.status}`)
    if (result.stderr) console.error(result.stderr)
    throw new Error(`gh exited ${result.status}`)
  }
  return result.stdout.trim()
}

// --- dry-run banner ------------------------------------------------------

export function announceDryRun(args) {
  if (args.dry) {
    warn('DRY RUN — no network requests will be made; pass without --dry to execute.')
  }
}
