#!/usr/bin/env node
/**
 * FILE: scripts/gen-env-reference.mjs
 * PURPOSE: The one environment-variable reference for self-hosting
 *          (apps/docs/content/self-hosting/environment.mdx), generated from the
 *          three templates an operator actually fills, and checked against the
 *          names the code reads so it cannot drift:
 *
 *            packages/server/.env.example  function secrets  (Deno.env.get in supabase/functions)
 *            deploy/.env.example           Compose .env      (${NAME} in deploy/docker-compose.yml)
 *            apps/admin/.env.example       console build     (import.meta.env.VITE_* in apps/admin/src)
 *
 *   pnpm gen:env-reference            # write the page
 *   pnpm check:env-reference          # exit 1 when the page is stale or code and templates disagree
 *
 * Template format: `# --- Title ---` starts a section; a run of comment lines
 * is a note for the variables after it; `NAME=value` is a variable
 * (commented out = optional); `# Default: x` in a note fills the Default
 * column. Edit the templates, never the generated page.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT = 'apps/docs/content/self-hosting/environment.mdx'
const CHECK = process.argv.includes('--check')

/** Set by Supabase (and by Compose for the edge-functions service); never set them yourself on Supabase. */
const PLATFORM = {
  SUPABASE_URL: 'The project URL. Compose passes the internal gateway, `http://caddy:8000`.',
  SUPABASE_ANON_KEY: 'The anon (public) key.',
  SUPABASE_SERVICE_ROLE_KEY: 'The service-role key. Server only.',
  SUPABASE_DB_URL: 'Direct Postgres connection string.',
  SB_REGION: 'Region the function runs in (read-only).',
}
/** Read by functions code but not configuration (runtime builtins). */
const RUNTIME_BUILTINS = new Set(['NODE_ENV'])

const SOURCES = [
  {
    id: 'functions',
    file: 'packages/server/.env.example',
    title: 'Function secrets',
    where: 'A Supabase function secret: `supabase secrets set NAME=value` (or Project Settings → Edge Functions → Secrets). In Docker Compose, add it to the `edge-functions` service environment.',
    required: { MUSHI_INTERNAL_CALLER_SECRET: '`selfhost up` and the Compose secrets script generate it' },
  },
  {
    id: 'compose',
    file: 'deploy/.env.example',
    title: 'Docker Compose (`deploy/.env`)',
    where: 'The `deploy/.env` file Compose reads. Generate it with `npx mushi-mushi selfhost secrets` or `./deploy/generate-secrets.sh`; never fill it by hand.',
    required: {
      POSTGRES_PASSWORD: 'generated',
      JWT_SECRET: 'generated',
      SUPABASE_ANON_KEY: 'generated (signed with JWT_SECRET)',
      SUPABASE_SERVICE_ROLE_KEY: 'generated (signed with JWT_SECRET)',
      MUSHI_INTERNAL_CALLER_SECRET: 'generated',
    },
  },
  {
    id: 'console',
    file: 'apps/admin/.env.example',
    title: 'Console build (`VITE_*`)',
    where: 'Build-time values for the admin console. Vite bakes them into the bundle, so changing one means rebuilding (a static build, `docker build --build-arg`, or `apps/admin/.env` for `pnpm dev`). A console built without them asks for the URL and anon key on first open.',
    required: { VITE_SUPABASE_URL: 'on a self-host', VITE_SUPABASE_ANON_KEY: 'on a self-host' },
  },
]

// ── Template parsing ──────────────────────────────────────────────────────

const SECTION_RE = /^#\s*-{2,}\s*(.+?)\s*-{2,}\s*$/
const BANNER_RE = /^#\s*={3,}\s*$/
const VAR_RE = /^(#\s*)?(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/

/** @returns {{ sections: Array<{ title: string | null, groups: Array<{ note: string[], vars: Array<{ name: string, optional: boolean, inline: string }> }> }> }} */
export function parseTemplate(text) {
  const sections = []
  let section = { title: null, groups: [] }
  let note = []
  let group = null
  const pushSection = () => {
    if (section.groups.length) sections.push(section)
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    // A `# ====` rule frames an intro; its text is reset by the blank line after it.
    if (BANNER_RE.test(line)) {
      note = []
      continue
    }
    if (!line) {
      group = null
      note = []
      continue
    }
    const sec = SECTION_RE.exec(line)
    if (sec) {
      pushSection()
      section = { title: sec[1], groups: [] }
      note = []
      group = null
      continue
    }
    const v = VAR_RE.exec(line)
    if (v) {
      const [, hash, name, rest] = v
      const inlineIdx = rest.search(/\s#\s/)
      const inline = inlineIdx === -1 ? '' : rest.slice(inlineIdx).replace(/^\s#\s*/, '').trim()
      if (!group || note.length) {
        group = { note, vars: [] }
        section.groups.push(group)
        note = []
      }
      if (!group.vars.some((x) => x.name === name)) group.vars.push({ name, optional: Boolean(hash), inline })
      continue
    }
    if (line.startsWith('#')) {
      // A comment after variables starts the next group's note.
      if (group && group.vars.length && !note.length) group = null
      note.push(line.replace(/^#\s?/, ''))
    }
  }
  pushSection()
  return { sections }
}

export function templateNames(text) {
  const out = new Set()
  for (const s of parseTemplate(text).sections) for (const g of s.groups) for (const v of g.vars) out.add(v.name)
  return out
}

/** `Default: x` / `defaults to x` in a note or inline comment. */
export function defaultOf(text) {
  const m = /\b[Dd]efault(?:s to)?:?\s+`?([^`.;,)]+?)`?(?:[.;,)]|$)/.exec(text)
  return m ? m[1].trim() : null
}

// ── Markdown (MDX-safe) ───────────────────────────────────────────────────

/** Escapes prose for an MDX table cell; code spans keep their text (only `|` is escaped there). */
export function mdxCell(text) {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part.replace(/\|/g, '\\|')
        : part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/\|/g, '\\|').replace(/\*/g, '\\*'),
    )
    .join('')
}

function renderSource(src, parsed) {
  const lines = [`## ${src.title}`, '', src.where, '']
  for (const section of parsed.sections) {
    if (section.title) lines.push(`### ${mdxCell(section.title)}`, '')
    lines.push('| Variable | Required | Default | What it does |', '| --- | --- | --- | --- |')
    for (const group of section.groups) {
      // A group's note describes the variables under it: it goes on the first
      // one, unless that variable has its own inline comment (then on the row
      // alone). Later rows say "same group" with a dash.
      const note = group.note.join(' ').trim()
      group.vars.forEach((v, i) => {
        const req = src.required[v.name] ? `Required: ${src.required[v.name]}` : 'Optional'
        const def = defaultOf(v.inline) ?? (group.vars.length === 1 ? defaultOf(note) : null)
        const what = [i === 0 ? note : '', v.inline].filter(Boolean).join(' ')
        lines.push(`| \`${v.name}\` | ${mdxCell(req)} | ${def ? `\`${def.replace(/\|/g, '\\|')}\`` : '—'} | ${what ? mdxCell(what) : '—'} |`)
      })
    }
    lines.push('')
  }
  return lines
}

export function renderPage(parsedBySource) {
  const lines = [
    '---',
    'title: Environment variables',
    'description: Every environment variable a self-hosted Mushi Mushi reads, where to set it, and whether it is required. Generated from the .env.example templates.',
    '---',
    '',
    "{/* GENERATED by scripts/gen-env-reference.mjs from packages/server/.env.example, deploy/.env.example and apps/admin/.env.example. Edit those templates, then run `pnpm gen:env-reference`. `pnpm check:env-reference` fails when this page or the templates drift from the code. */}",
    '',
    '# Environment variables',
    '',
    'You need very few of these. `npx mushi-mushi selfhost up` sets the required function secrets for you, and `npx mushi-mushi selfhost secrets` writes the Compose `.env`. Everything else turns on an optional feature.',
    '',
    '| You run | Required | Set by |',
    '| --- | --- | --- |',
    '| Your own Supabase project | `MUSHI_INTERNAL_CALLER_SECRET` | `selfhost up` |',
    '| Docker Compose | `POSTGRES_PASSWORD`, `JWT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MUSHI_INTERNAL_CALLER_SECRET` | `selfhost secrets` |',
    '| A console you build yourself | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | your build command |',
    '',
    'An AI key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) is optional: without one, reports get rule-based triage, and no plain-English diagnosis.',
    '',
    '## Set by the platform',
    '',
    'Supabase sets these in every function. Compose passes them to the `edge-functions` service. Do not set them yourself on Supabase.',
    '',
    '| Variable | Notes |',
    '| --- | --- |',
    ...Object.entries(PLATFORM).map(([n, d]) => `| \`${n}\` | ${mdxCell(d)} |`),
    '',
  ]
  for (const src of SOURCES) lines.push(...renderSource(src, parsedBySource[src.id]))
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

// ── Code reads ────────────────────────────────────────────────────────────

const TEST_RE = /(\.(test|spec)\.[^/]+$)|((^|\/)(__tests__|__mocks__|__stubs__)\/)/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(abs)
  }
  return out
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '')
}

function sources(dir) {
  return walk(join(ROOT, dir))
    .filter((abs) => !TEST_RE.test(relative(ROOT, abs).split(sep).join('/')))
    .map((abs) => stripComments(readFileSync(abs, 'utf8')))
}

export function collectReads() {
  const fnText = sources('packages/server/supabase/functions')
  const fnReads = new Set()
  for (const t of fnText) for (const m of t.matchAll(/Deno\.env\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)) fnReads.add(m[1])
  const fnLiterals = new Set()
  for (const t of fnText) for (const m of t.matchAll(/['"`]([A-Z][A-Z0-9_]{2,})['"`]/g)) fnLiterals.add(m[1])
  const adminReads = new Set()
  for (const t of sources('apps/admin/src')) for (const m of t.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) adminReads.add(m[1])
  const compose = readFileSync(join(ROOT, 'deploy/docker-compose.yml'), 'utf8')
  const composeVars = new Set([...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]))
  return { fnReads, fnLiterals, adminReads, composeVars }
}

/** Disagreements between the code and the templates, as fixable lines. */
export function driftProblems({ fnReads, fnLiterals, adminReads, composeVars }, names) {
  const problems = []
  for (const n of [...fnReads].sort()) {
    if (PLATFORM[n] || RUNTIME_BUILTINS.has(n) || names.functions.has(n)) continue
    problems.push(`functions read ${n} but packages/server/.env.example does not list it`)
  }
  for (const n of [...names.functions].sort()) {
    if (!fnLiterals.has(n)) problems.push(`packages/server/.env.example lists ${n} but no function reads it`)
  }
  for (const n of [...adminReads].sort()) {
    if (!names.console.has(n)) problems.push(`the console reads ${n} but apps/admin/.env.example does not list it`)
  }
  for (const n of [...names.console].sort()) {
    if (!adminReads.has(n)) problems.push(`apps/admin/.env.example lists ${n} but the console never reads it`)
  }
  for (const n of [...composeVars].sort()) {
    if (!names.compose.has(n)) problems.push(`deploy/docker-compose.yml reads \${${n}} but deploy/.env.example does not list it`)
  }
  for (const n of [...names.compose].sort()) {
    if (!composeVars.has(n)) problems.push(`deploy/.env.example lists ${n} but deploy/docker-compose.yml never reads it`)
  }
  return problems
}

function main() {
  const parsed = {}
  const names = {}
  for (const src of SOURCES) {
    const text = readFileSync(join(ROOT, src.file), 'utf8')
    parsed[src.id] = parseTemplate(text)
    names[src.id] = templateNames(text)
  }
  const page = renderPage(parsed)
  const problems = driftProblems(collectReads(), names)
  const outAbs = join(ROOT, OUT)
  let current = ''
  try {
    current = readFileSync(outAbs, 'utf8')
  } catch {
    // first run
  }
  if (!CHECK) {
    writeFileSync(outAbs, page)
    console.log(`wrote ${OUT}`)
  } else if (current.replace(/\r\n/g, '\n') !== page) {
    problems.push(`${OUT} is stale: run pnpm gen:env-reference`)
  }
  if (problems.length) {
    console.error(`✗ env-reference: ${problems.length} problem(s)`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('✓ env-reference: the page, the templates and the code agree')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
