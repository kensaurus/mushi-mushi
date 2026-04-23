// scripts/marketing/propose-awesome-pr.mjs
//
// Opens a properly-formatted PR against an awesome-* list with a Mushi
// Mushi entry. Designed for one-PR-at-a-time use — emphatically NOT a
// bulk submitter. Awesome-list maintainers explicitly reject mechanical
// drive-by PRs (see https://github.com/sindresorhus/awesome — Pull
// Requests guidelines), so this script:
//
//   1. forks the upstream repo (gh repo fork --remote=false)
//   2. clones the fork into .cache/awesome-prs/<repo>
//   3. opens the README at the line you tell it to
//   4. inserts the entry on the line index you specify
//   5. commits, pushes, opens a PR with a thoughtful body
//   6. PRINTS THE LINK so you can do the final read-through and tweak
//      before notifying maintainers
//
// You still own the alphabetisation decision and the entry wording —
// the script is a typing-saver, not an auto-pilot. Tracker entries for
// each awesome-list live in docs/marketing/drip-channels.md.
//
// Usage:
//   node scripts/marketing/propose-awesome-pr.mjs \
//     --upstream sindresorhus/awesome-nodejs \
//     --section "## Logging" \
//     --entry "- [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) - Friendly user-friction layer that complements Sentry. LLM-native, auto-fixes via draft PRs." \
//     --branch add-mushi-mushi \
//     --pr-title "Add Mushi Mushi to ## Logging" \
//     --pr-body "Hi! Mushi Mushi (MIT, ~9k LOC) ..."
//
//   ... or pass --dry to print the patch without forking/pushing.
//
// Notes:
//   - Inserts the entry alphabetically inside the named section, by reading
//     the section block (## Heading ... next ##), parsing each line that
//     starts with `- [Name]`, and finding the right slot. If the section
//     has no entries yet, it appends as the first list item.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname, basename } from 'node:path'
import { loadEnv, gh, parseArgs, REPO_ROOT, step, ok, warn, err, announceDryRun } from './lib.mjs'

loadEnv()
const args = parseArgs()
announceDryRun(args)

function requireFlag(flag, hint) {
  if (!args[flag]) {
    err(`Missing --${flag}.${hint ? ' ' + hint : ''}`)
    process.exit(1)
  }
  return args[flag]
}

const UPSTREAM = requireFlag('upstream', 'e.g. sindresorhus/awesome-nodejs')
const SECTION = requireFlag('section', 'e.g. "## Logging"')
const ENTRY = requireFlag('entry', 'e.g. "- [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) - …"')
const BRANCH = args.branch || 'add-mushi-mushi'
const PR_TITLE = args['pr-title'] || `Add Mushi Mushi (${SECTION.replace(/^#+\s*/, '')})`
const PR_BODY =
  args['pr-body'] ||
  `Hi! Mushi Mushi is an open-source (MIT) user-friction intelligence layer that catches user-felt bugs that traditional monitoring misses, classifies them with an LLM, and dispatches a draft PR fix. Live admin demo: https://kensaur.us/mushi-mushi/

Trying to slot it under **${SECTION}** alphabetically. Happy to adjust placement, formatting, or wording — just let me know what works for the list.`

const README_FILE = args['readme'] || 'readme.md'

step(`Upstream:   ${UPSTREAM}`)
step(`Section:    ${SECTION}`)
step(`Entry:      ${ENTRY}`)
step(`PR title:   ${PR_TITLE}`)
step(`Branch:     ${BRANCH}`)

// --- helpers -------------------------------------------------------------

const FORK_BASE = resolve(REPO_ROOT, '.cache', 'awesome-prs')
const CLONE_DIR = resolve(FORK_BASE, basename(UPSTREAM))

function git(cwd, ...args) {
  // shell:false for the same reason as gh — Windows arg-mangling.
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  if (result.status !== 0) {
    err(`git ${args.join(' ')} → exit ${result.status}`)
    if (result.stderr) console.error(result.stderr)
    throw new Error(`git exited ${result.status}`)
  }
  return result.stdout.trim()
}

// Insert ENTRY into the README inside the named section, alphabetically.
// Returns { content, inserted: true|false }. If the section doesn't exist
// returns { inserted: false } so the caller can bail with a clear error.
function insertAlpha(readme, sectionHeading, entry) {
  const lines = readme.split(/\r?\n/)
  const sectionRe = new RegExp(
    '^' + sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$',
    'i',
  )
  let sectionStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (sectionRe.test(lines[i])) {
      sectionStart = i
      break
    }
  }
  if (sectionStart < 0) return { inserted: false }

  // Section ends at the next heading at the same level or any heading of
  // higher level (fewer #).
  const sectionLevel = (sectionHeading.match(/^#+/) || ['##'])[0].length
  let sectionEnd = lines.length
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/)
    if (m && m[1].length <= sectionLevel) {
      sectionEnd = i
      break
    }
  }

  // Find the contiguous block of `- [Name]` entries and pick the alpha slot.
  const entryNameRe = /^\s*-\s+\[([^\]]+)\]/
  const newName = (entry.match(entryNameRe) || [, ''])[1].toLowerCase()

  let firstEntryIndex = -1
  let lastEntryIndex = -1
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    if (entryNameRe.test(lines[i])) {
      if (firstEntryIndex < 0) firstEntryIndex = i
      lastEntryIndex = i
    }
  }

  if (firstEntryIndex < 0) {
    // Empty section — insert just after the heading + a blank line.
    const insertAt = sectionStart + 2
    lines.splice(insertAt, 0, entry)
    return { content: lines.join('\n'), inserted: true, insertAt }
  }

  // Find the alpha slot. Note: many awesome-lists ignore leading articles
  // ("The ", "A "), but we don't — keep it simple. Reviewers can re-sort.
  let insertAt = lastEntryIndex + 1
  for (let i = firstEntryIndex; i <= lastEntryIndex; i++) {
    const m = lines[i].match(entryNameRe)
    if (!m) continue
    if (m[1].toLowerCase() > newName) {
      insertAt = i
      break
    }
  }
  lines.splice(insertAt, 0, entry)
  return { content: lines.join('\n'), inserted: true, insertAt }
}

// --- fork + clone --------------------------------------------------------

mkdirSync(FORK_BASE, { recursive: true })

if (!args.dry) {
  step('Forking upstream...')
  // gh repo fork is idempotent; if a fork already exists it returns OK
  // and prints "already exists". `--clone=false` because we manage the
  // clone path ourselves below.
  try {
    gh(['repo', 'fork', UPSTREAM, '--clone=false', '--remote=false'])
  } catch {
    warn('Fork may already exist; continuing.')
  }

  if (existsSync(CLONE_DIR)) {
    step(`Refreshing existing clone at ${CLONE_DIR}`)
    git(CLONE_DIR, 'fetch', '--all', '--prune')
    // Reset to upstream master/main so we're not stacking on stale history.
    const defaultBranch = gh([
      'repo',
      'view',
      UPSTREAM,
      '--json',
      'defaultBranchRef',
      '--jq',
      '.defaultBranchRef.name',
    ])
    git(CLONE_DIR, 'checkout', defaultBranch)
    git(CLONE_DIR, 'reset', '--hard', `upstream/${defaultBranch}`)
  } else {
    step(`Cloning fork into ${CLONE_DIR}`)
    const me = gh(['api', 'user', '--jq', '.login'])
    git(FORK_BASE, 'clone', `https://github.com/${me}/${basename(UPSTREAM)}.git`)
    git(CLONE_DIR, 'remote', 'add', 'upstream', `https://github.com/${UPSTREAM}.git`)
    git(CLONE_DIR, 'fetch', 'upstream')
  }
} else {
  // Dry-run path: clone shallowly into a tmp dir so we can still produce
  // the patch preview. Without a clone we can't compute the alpha slot.
  if (!existsSync(CLONE_DIR)) {
    step(`(dry) shallow-cloning ${UPSTREAM} read-only`)
    git(FORK_BASE, 'clone', '--depth=1', `https://github.com/${UPSTREAM}.git`)
  }
}

// --- find readme + insert -----------------------------------------------

// Awesome-lists capitalise readme inconsistently. Try a few likely names.
const candidates = ['readme.md', 'README.md', 'Readme.md']
const readmePath = candidates
  .map((n) => resolve(CLONE_DIR, n))
  .find((p) => existsSync(p))
if (!readmePath) {
  err(`No README found in ${CLONE_DIR}.`)
  process.exit(1)
}

const original = readFileSync(readmePath, 'utf8')
const result = insertAlpha(original, SECTION, ENTRY)
if (!result.inserted) {
  err(`Section "${SECTION}" not found in ${readmePath}. Check the heading wording.`)
  process.exit(1)
}

ok(`Inserting at line ${result.insertAt + 1}.`)
console.log('')
console.log('  ' + ENTRY)
console.log('')

if (args.dry) {
  warn('Dry run — not writing, committing, pushing, or opening a PR.')
  process.exit(0)
}

writeFileSync(readmePath, result.content)

// --- branch, commit, push, PR -------------------------------------------

step(`Branching to ${BRANCH}...`)
try {
  git(CLONE_DIR, 'checkout', '-B', BRANCH)
} catch {
  // -B forces, so this path shouldn't fail; defensive log only.
  err('Branch creation failed. Check git status in the clone dir.')
  process.exit(1)
}

git(CLONE_DIR, 'add', readmePath)
const status = git(CLONE_DIR, 'status', '--porcelain')
if (!status) {
  warn('No diff to commit — entry may already be present in the upstream.')
  process.exit(0)
}

git(CLONE_DIR, 'commit', '-m', PR_TITLE)
step('Pushing branch to fork...')
git(CLONE_DIR, 'push', '--set-upstream', 'origin', BRANCH, '--force-with-lease')

step('Opening PR...')
const url = gh([
  'pr',
  'create',
  '--repo',
  UPSTREAM,
  '--title',
  PR_TITLE,
  '--body',
  PR_BODY,
  '--head',
  `${gh(['api', 'user', '--jq', '.login'])}:${BRANCH}`,
])
ok(`PR opened: ${url}`)
warn('Read it once before notifying — list maintainers can tell when humans bothered.')
