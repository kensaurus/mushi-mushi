// scripts/marketing/setup-github.mjs
//
// One-shot retail-readiness pass on the GitHub repo chrome:
//   - Sets the About description and homepage URL
//   - Replaces topics with the 22-topic set from docs/marketing/STOREFRONTS.md
//   - Opens (or updates) the "Submit Mushi to an awesome-* list" good-first-issue
//     so contributors have a one-click way to help with the launch
//
// Usage:
//   node scripts/marketing/setup-github.mjs            # actually applies
//   node scripts/marketing/setup-github.mjs --dry      # prints the plan
//
// Requirements:
//   - `gh` CLI installed and authenticated as a user with admin rights on
//     kensaurus/mushi-mushi (the repo owner). Verified via `gh auth status`
//     before any mutation runs.
//
// What this script intentionally does NOT do:
//   - Upload the social preview image. The GitHub REST API for repository
//     social preview images is still on the undocumented `repository_image`
//     endpoint that requires a multipart upload through the GitHub web UI's
//     anti-CSRF token. We generate the image asset locally
//     (docs/social-preview/) and surface a one-line manual upload reminder
//     at the end of the run instead of pretending to automate something
//     fragile.

import { loadEnv, gh, step, ok, warn, parseArgs, announceDryRun } from './lib.mjs'

loadEnv()
const args = parseArgs()
announceDryRun(args)

const REPO = process.env.MARKETING_REPO || 'kensaurus/mushi-mushi'

// Source of truth for both fields lives in docs/marketing/STOREFRONTS.md.
// Keeping the literal here so the script has zero docs-parsing surface;
// when STOREFRONTS.md changes, update both.
const ABOUT = {
  description:
    'The friendly user-friction layer that complements Sentry. LLM-native, auto-fixes via draft PRs.',
  homepage: 'https://kensaur.us/mushi-mushi/',
}

// GitHub caps repository topics at 20 (`HTTP 422: A repository cannot have
// more than 20 topics`). The two trimmed from the original storefront
// shortlist are `shake-to-report` and `pdca` — both are niche internal
// terms with negligible GitHub-topic search volume; the broader cousins
// (`feedback-widget`, `observability`) carry the same audience signal.
const TOPICS = [
  'sentry',
  'bug-reporting',
  'user-feedback',
  'user-friction',
  'llm',
  'llm-ops',
  'ai-agent',
  'auto-fix',
  'observability',
  'session-replay',
  'feedback-widget',
  'typescript',
  'react',
  'vue',
  'svelte',
  'angular',
  'react-native',
  'supabase',
  'mcp',
  'claude-code',
]

const GOOD_FIRST_ISSUE = {
  title: 'Submit Mushi to an awesome-* list (good first issue)',
  labels: ['good first issue', 'documentation', 'community'],
  body: `## Help next devs find Mushi 🐛

Awesome-lists are still one of the highest-leverage discovery surfaces for OSS devtools — a single merged PR can compound for years. We have drafted candidate entries in [\`docs/marketing/drip-channels.md\`](../docs/marketing/drip-channels.md), but each list has its own alphabetisation, badge convention, and one-line format. We need humans to read each list's contributing guide and adapt the entry.

**How to help (≈ 15 min per PR):**

1. Pick one awesome-list from the table in [\`docs/marketing/drip-channels.md\`](../docs/marketing/drip-channels.md). Tick it in this issue so others know.
2. Read that list's \`CONTRIBUTING.md\` — alphabetisation rules, badge style, one-line format.
3. Adapt the candidate entry from \`drip-channels.md\` to the list's conventions.
4. Open the PR upstream. Reply here with the link.

We will thank every merged PR in the next release notes and on Bluesky.

**Do not** run automated bulk submissions — list maintainers reject those on sight, and it burns the lists for the next OSS project that needs them.`,
}

step(`Repo ${REPO}`)

if (!args.dry) {
  // Belt-and-braces auth check so we don't burn API quota on a 401 cascade.
  gh(['auth', 'status'])
}

// --- About ---------------------------------------------------------------

step(`About → "${ABOUT.description}"`)
step(`Homepage → ${ABOUT.homepage}`)
if (!args.dry) {
  gh([
    'repo',
    'edit',
    REPO,
    '--description',
    ABOUT.description,
    '--homepage',
    ABOUT.homepage,
  ])
  ok('About + homepage updated.')
}

// --- Topics --------------------------------------------------------------

step(`Topics → ${TOPICS.length} entries (${TOPICS.slice(0, 4).join(', ')}, …)`)
if (!args.dry) {
  // gh repo edit applies adds and removes; the safe move is to read the
  // current set, remove anything that's not in our target list, then add
  // the difference. That preserves any pre-existing topic the maintainer
  // intentionally added (e.g. a hackathon tag) but keeps the canonical
  // list authoritative.
  const currentRaw = gh(['repo', 'view', REPO, '--json', 'repositoryTopics'])
  // repositoryTopics is `null` (not `[]`) when the repo has zero topics —
  // gh returns the raw GraphQL shape. Coerce to an array so .map is safe.
  const current = (JSON.parse(currentRaw).repositoryTopics ?? []).map(
    (t) => t.name,
  )
  const toAdd = TOPICS.filter((t) => !current.includes(t))
  const toRemove = current.filter((t) => !TOPICS.includes(t))
  if (toAdd.length === 0 && toRemove.length === 0) {
    ok('Topics already in sync.')
  } else {
    const editArgs = ['repo', 'edit', REPO]
    for (const t of toAdd) {
      editArgs.push('--add-topic', t)
    }
    for (const t of toRemove) {
      editArgs.push('--remove-topic', t)
    }
    gh(editArgs)
    ok(`Topics updated: +${toAdd.length}  −${toRemove.length}`)
  }
}

// --- Good-first-issue ----------------------------------------------------

step(`Good-first-issue: "${GOOD_FIRST_ISSUE.title}"`)
if (!args.dry) {
  // Idempotency: if an open issue with this exact title already exists, do
  // not create a duplicate. Marketing scripts must be safe to re-run.
  const listRaw = gh([
    'issue',
    'list',
    '--repo',
    REPO,
    '--search',
    `"${GOOD_FIRST_ISSUE.title}" in:title is:open`,
    '--json',
    'number,title',
    '--limit',
    '5',
  ])
  const existing = JSON.parse(listRaw).find((i) => i.title === GOOD_FIRST_ISSUE.title)
  if (existing) {
    ok(`Issue #${existing.number} already open — no duplicate created.`)
  } else {
    // Filter to only labels that already exist on the repo. gh `--label`
    // hard-fails the whole request if any label is missing, so we keep
    // this script portable across forks / freshly-created repos by
    // intersecting against the repo's actual label set.
    const labelsRaw = gh([
      'label',
      'list',
      '--repo',
      REPO,
      '--limit',
      '200',
      '--json',
      'name',
    ])
    const repoLabels = new Set(JSON.parse(labelsRaw).map((l) => l.name))
    const labels = GOOD_FIRST_ISSUE.labels.filter((l) => repoLabels.has(l))
    const skipped = GOOD_FIRST_ISSUE.labels.filter((l) => !repoLabels.has(l))
    if (skipped.length) {
      warn(`Skipping labels not present on repo: ${skipped.join(', ')}`)
    }

    const issueArgs = [
      'issue',
      'create',
      '--repo',
      REPO,
      '--title',
      GOOD_FIRST_ISSUE.title,
      '--body',
      GOOD_FIRST_ISSUE.body,
    ]
    for (const label of labels) {
      issueArgs.push('--label', label)
    }
    const url = gh(issueArgs)
    ok(`Issue opened: ${url}`)
  }
}

// --- Manual leftover -----------------------------------------------------

warn(
  'Social preview image must be uploaded by hand — Settings → "Social preview" → upload docs/social-preview/og-card.png. (GitHub does not expose a stable API for this.)',
)
