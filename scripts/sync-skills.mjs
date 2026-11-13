#!/usr/bin/env node
// FILE: sync-skills.mjs
// PURPOSE: `skills/` is the one hand-edited copy of the Mushi Mushi agent
//          skills (ADR 0060, "Skills: one source"). `npx skills add
//          kensaurus/mushi-mushi` installs straight from it. The two editor
//          plugins ship the same skills, generated from it by this script:
//
//            • packages/cursor-plugin/skills/<name>/   (Cursor plugin; its
//              .cursor-plugin/plugin.json `skills` list is rewritten too)
//            • plugins/mushi-debugger/skills/<name>/   (Claude Code plugin;
//              Claude Code scans a plugin's skills/ folder on its own)
//
// Each generated SKILL.md carries a GENERATED notice right after its
// frontmatter. The notice goes after the frontmatter, not before it: editors
// only read the frontmatter when the file starts with `---`.
//
// Do not add a `skills` field to .claude-plugin/marketplace.json: the skills
// CLI reads skill paths declared there, and would then list every skill twice.
//
// Modes:
//   node scripts/sync-skills.mjs           → write the plugin copies
//   node scripts/sync-skills.mjs --check   → fail if a copy is missing, stale
//                                            or left over, if plugin.json lists
//                                            the wrong skills, or if a source
//                                            skill's frontmatter is invalid,
//                                            or if the Connect pages'
//                                            CONNECT_SKILLS.skillNames disagree
//                                            with skills/ (CI / pre-commit guard)
//
// Idempotent. Line endings are normalised to LF (the repo's .gitattributes).

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'skills'
const TARGETS = ['packages/cursor-plugin/skills', 'plugins/mushi-debugger/skills']
const CURSOR_MANIFEST = 'packages/cursor-plugin/.cursor-plugin/plugin.json'
// Copy files whose CONNECT_SKILLS.skillNames must name exactly these skills.
const COPY_FILES = ['apps/admin/src/lib/public-copy-shared.ts', 'apps/docs/lib/public-copy.ts']
// The Agent Skills spec and skill-sync both cap a description at 1024 chars.
const MAX_DESCRIPTION = 1024

const check = process.argv.includes('--check')
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/')
const lf = (s) => s.replace(/\r\n/g, '\n')

// Read or list a path directly and treat "not there" as empty. Checking with
// existsSync()/statSync() first and then reading or writing is a
// time-of-check/time-of-use race (CodeQL js/file-system-race).
const isMissing = (err) => err?.code === 'ENOENT' || err?.code === 'ENOTDIR'

/** The file's text with LF line endings, or null when it does not exist. */
function readIfPresent(path) {
  try {
    return lf(readFileSync(path, 'utf8'))
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

/** A directory's entries, or [] when the directory does not exist. */
function entriesOf(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
}

function listFiles(dir, base = dir) {
  const out = []
  for (const entry of entriesOf(dir)) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full, base))
    else out.push(relative(base, full).replaceAll('\\', '/'))
  }
  return out.sort()
}

function listSkillDirs(dir) {
  return entriesOf(dir)
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

/** Split `---\n…\n---\n` frontmatter from the body; null when there is none. */
function splitFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  return m ? { frontmatter: m[1], end: m[0].length } : null
}

function frontmatterValue(frontmatter, key) {
  const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(frontmatter)
  if (!m) return null
  let value = m[1].trim()
  if (value === '>-' || value === '>' || value === '|') {
    // Folded block: the indented lines after the key.
    const after = frontmatter.slice(m.index + m[0].length).split('\n').slice(1)
    const lines = []
    for (const line of after) {
      if (!/^\s+\S/.test(line)) break
      lines.push(line.trim())
    }
    return lines.join(' ')
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return value
}

function notice(name) {
  return (
    `<!-- GENERATED from skills/${name}/SKILL.md by scripts/sync-skills.mjs. ` +
    `Do not edit this copy: edit the source, then run \`pnpm sync:skills\`. -->\n\n`
  )
}

/** The file a plugin ships for one source file. */
function generated(name, file, text) {
  if (file !== 'SKILL.md') return text
  const fm = splitFrontmatter(text)
  return text.slice(0, fm.end) + '\n' + notice(name) + text.slice(fm.end).replace(/^\n+/, '')
}

const problems = []
let written = 0

// 1. Read and validate the source skills.
const sourceRoot = join(ROOT, SOURCE)
const skills = []
for (const name of listSkillDirs(sourceRoot)) {
  const dir = join(sourceRoot, name)
  const skillPath = join(dir, 'SKILL.md')
  const text = readIfPresent(skillPath)
  if (text === null) {
    problems.push(`${rel(dir)} has no SKILL.md`)
    continue
  }
  const fm = splitFrontmatter(text)
  if (!fm) {
    problems.push(`${rel(skillPath)} must start with --- frontmatter`)
    continue
  }
  const declared = frontmatterValue(fm.frontmatter, 'name')
  if (declared !== name) problems.push(`${rel(skillPath)}: name "${declared}" must match its folder "${name}"`)
  const description = frontmatterValue(fm.frontmatter, 'description')
  if (!description) problems.push(`${rel(skillPath)}: missing description`)
  else if (description.length > MAX_DESCRIPTION) {
    problems.push(`${rel(skillPath)}: description is ${description.length} chars (max ${MAX_DESCRIPTION})`)
  }
  if (text.includes('GENERATED from skills/')) problems.push(`${rel(skillPath)} is a source file but carries a GENERATED notice`)
  const files = new Map()
  for (const file of listFiles(dir)) {
    const raw = readIfPresent(join(dir, file)) ?? ''
    files.set(file, file === 'SKILL.md' ? generated(name, file, raw) : raw)
  }
  skills.push({ name, files })
}

if (skills.length === 0) problems.push(`${SOURCE}/ holds no skills`)

// 2. Each plugin's copy.
if (problems.length === 0) {
  for (const target of TARGETS) {
    const targetRoot = join(ROOT, target)
    const wanted = new Set(skills.map((s) => s.name))
    for (const stale of listSkillDirs(targetRoot).filter((n) => !wanted.has(n))) {
      if (check) problems.push(`${target}/${stale} has no source in ${SOURCE}/ (delete it, or run pnpm sync:skills)`)
      else {
        rmSync(join(targetRoot, stale), { recursive: true, force: true })
        written++
      }
    }
    for (const { name, files } of skills) {
      const dir = join(targetRoot, name)
      const present = listFiles(dir)
      for (const extra of present.filter((f) => !files.has(f))) {
        if (check) problems.push(`${target}/${name}/${extra} has no source`)
        else {
          rmSync(join(dir, extra), { force: true })
          written++
        }
      }
      for (const [file, want] of files) {
        const dest = join(dir, file)
        const current = readIfPresent(dest)
        if (current === want) continue
        if (check) {
          problems.push(`${rel(dest)} is ${current === null ? 'missing' : 'stale'}`)
          continue
        }
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, want, 'utf8')
        written++
      }
    }
  }

  // 3. The Cursor manifest lists every skill folder it ships.
  const manifestPath = join(ROOT, CURSOR_MANIFEST)
  const manifestText = lf(readFileSync(manifestPath, 'utf8'))
  const manifest = JSON.parse(manifestText)
  const wantSkills = skills.map((s) => `skills/${s.name}`)
  if (JSON.stringify(manifest.skills) !== JSON.stringify(wantSkills)) {
    if (check) {
      problems.push(`${CURSOR_MANIFEST} "skills" is ${JSON.stringify(manifest.skills)}, expected ${JSON.stringify(wantSkills)}`)
    } else {
      manifest.skills = wantSkills
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      written++
    }
  }
}

// 4. The Connect pages (console and docs) list the skills by name from
//    CONNECT_SKILLS.skillNames. They listed five stale names once; hold both
//    copies to skills/. Display order is theirs, so compare as sets.
if (skills.length > 0) {
  const want = skills.map((s) => s.name).sort()
  for (const file of COPY_FILES) {
    const text = lf(readFileSync(join(ROOT, file), 'utf8'))
    const m = /skillNames:\s*\[([^\]]*)\]/.exec(text)
    if (!m) {
      problems.push(`${file}: CONNECT_SKILLS.skillNames not found`)
      continue
    }
    const listed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
    if (JSON.stringify(listed) !== JSON.stringify(want)) {
      problems.push(`${file}: CONNECT_SKILLS.skillNames is ${JSON.stringify(listed)}, skills/ has ${JSON.stringify(want)} (edit it by hand)`)
    }
  }
}

if (problems.length > 0) {
  console.error(`\nsync-skills${check ? ' --check' : ''} FAILED:\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error(
    `\nEdit only ${SOURCE}/<name>/SKILL.md, then run \`pnpm sync:skills\` and commit the plugin copies.\n`,
  )
  process.exit(1)
}

const names = skills.map((s) => s.name).join(', ')
if (check) console.log(`sync-skills --check OK — ${skills.length} skill(s) in sync across ${TARGETS.length} plugins: ${names}`)
else console.log(`sync-skills wrote ${written} file(s); ${skills.length} skill(s) across ${TARGETS.length} plugins: ${names}`)
