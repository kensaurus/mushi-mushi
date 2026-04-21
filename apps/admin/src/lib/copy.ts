/**
 * FILE: apps/admin/src/lib/copy.ts
 * PURPOSE: Plain-language copy registry for beginner mode (Wave L).
 *
 *  Two parallel string maps (`beginner` / `advanced`) keyed by page route
 *  and field. Beginner mode pulls from `beginner`; advanced preserves the
 *  current jargon-rich copy power users already know. Renaming or softening
 *  a phrase is one edit here, not a sweep across 23 pages.
 *
 *  Conventions:
 *   - Beginner copy is outcome-first ("Bugs your users actually felt"),
 *     not capability-first ("Triage queue").
 *   - Section titles are < 5 words, sentence case.
 *   - PageHelp.whatIsIt is one sentence, < 25 words, no acronyms.
 *   - Use <Jargon term="X"> in JSX to wrap unavoidable jargon — that
 *     primitive renders an <abbr> with a plain-language tooltip in
 *     beginner mode and the bare word in advanced.
 */

import { useAdminMode } from './mode'

interface PageCopy {
  /** Page-header title (overrides the in-page title in beginner mode). */
  title?: string
  /** Page-header sub-description. */
  description?: string
  /** Section header rewrites (sectionId → title). */
  sections?: Record<string, string>
  /** PageHelp body. Same shape as <PageHelp> props. */
  help?: {
    title: string
    whatIsIt: string
    useCases?: string[]
    howToUse?: string
  }
}

interface CopyRegistry {
  quickstart: Record<string, PageCopy>
  beginner: Record<string, PageCopy>
  advanced: Record<string, PageCopy>
}

export const COPY: CopyRegistry = {
  // Quickstart mode: only 3 routes are surfaced in the sidebar (Inbox /
  // Drafts / Setup), so we override copy on just those plus the dashboard
  // landing. Everything else falls through to beginner copy via
  // `usePageCopy`. Wave N.
  quickstart: {
    '/': {
      title: 'Bugs to fix',
      description: "Your real users hit these. Click any to see the screenshot, console, and steps — then send to auto-fix.",
      help: {
        title: 'How Mushi helps',
        whatIsIt:
          'Mushi catches bugs your users hit, drafts a fix as a pull request, and sends it back to your repo. Three pages in Quickstart: bugs to fix, fixes ready to merge, setup.',
        useCases: [
          'See the bugs your real users felt today',
          'Open the worst one, send it to the auto-fix agent',
          'Review the draft pull request, merge if it looks right',
        ],
        howToUse:
          'Use the big "Resolve next bug" button at the top to jump to the highest-priority report. The auto-fix agent does the heavy lifting.',
      },
    },
    '/reports': {
      title: 'Bugs to fix',
      description: 'Your most-felt bugs first. Click one to see the proof — screenshot, console, and reproduction steps.',
      help: {
        title: 'About bugs',
        whatIsIt:
          'A list of bugs your end-users flagged, automatically grouped, scored, and ranked by how many people are affected.',
        useCases: [
          'Find the worst bug today and send it to the auto-fix agent',
          'See real screenshots and reproduction steps before deciding',
          'Mute or close noisy reports so the model learns',
        ],
        howToUse: 'Click any bug to open the full proof. Click "Send to auto-fix" to draft a pull request.',
      },
    },
    '/fixes': {
      title: 'Fixes ready to merge',
      description: 'Pull requests Mushi drafted from your real bugs. Review the diff and click "Open PR" to merge.',
      help: {
        title: 'About drafted fixes',
        whatIsIt:
          'Each item is a draft pull request the auto-fix agent opened on your behalf, with a one-paragraph rationale and a screenshot diff.',
        useCases: [
          'Review fixes like a junior engineer\u2019s first attempt',
          'Re-run with a different prompt if the first miss',
          'Open the PR to land it in GitHub',
        ],
        howToUse: 'Click any fix to see the side-by-side diff. Use "Open PR" to land it.',
      },
    },
    '/onboarding': {
      title: 'Setup',
      description: 'Three short steps: create a project, install the widget, send a test bug.',
      help: {
        title: 'About setup',
        whatIsIt: 'Get Mushi connected to your app in about 10 minutes — copy a snippet, paste your URL, send a test bug.',
        useCases: [
          'First-time setup of a new project',
          'Add a second project (e.g. staging)',
          'Re-install the widget on a new app',
        ],
        howToUse: 'Follow the steps in order. The checklist tracks your progress automatically.',
      },
    },
  },
  beginner: {
    '/': {
      title: 'Your bug-fix loop',
      description: 'Watch a real user complaint travel from your app to a merged PR.',
      help: {
        title: 'How to read this dashboard',
        whatIsIt:
          'A live picture of bugs your users hit, fixes Mushi drafted, judge scores, and where fixes shipped — all on one screen.',
        useCases: [
          'See whether new bug reports are rising or falling this week',
          'Spot a backlog before users start complaining',
          'Open the highest-priority report that needs a human review',
        ],
        howToUse:
          'Click any tile to drill into that stage. Hover charts to see per-day numbers.',
      },
    },
    '/reports': {
      title: 'Bugs your users felt',
      description: 'Real complaints, grouped and scored. Click one to see the screenshot + console + steps to reproduce.',
      sections: {
        triage_queue: 'Waiting for review',
      },
      help: {
        title: 'About reports',
        whatIsIt:
          'A list of bugs your end-users flagged, automatically grouped, scored, and ranked by how many people are affected.',
        useCases: [
          'Find the most-felt bug today (sorted by user count)',
          'Send the top one to the auto-fix agent — it drafts a PR for you to review',
          'Mute noisy reports or tag false positives so the model learns',
        ],
        howToUse:
          'Click any row for the full report. Click "Send to auto-fix" to draft a pull request. Filter by severity, status, or date.',
      },
    },
    '/graph': {
      title: 'How bugs connect',
      description: 'A live map of which components, pages, and releases your bugs cluster around. Click any node to see what it can break.',
      help: {
        title: 'About the bug map',
        whatIsIt:
          'Every bug points at a component, page, or release. This map joins those dots so you can see where the breakage clusters.',
        useCases: [
          'Find your most fragile component (the one with the most incoming bugs)',
          'Spot regressions — bugs that came back after a fix',
          'See the blast radius of a single bug before you ship a fix',
        ],
        howToUse:
          'Click a node to highlight everything it can affect. Drag the canvas to pan. Switch to the table view if you prefer rows.',
      },
    },
    '/fixes': {
      title: 'Auto-drafted fixes',
      description: 'Pull requests Mushi opened on your behalf. Review the diff, judge score, and screenshot proof — then merge.',
      help: {
        title: 'About auto-fixes',
        whatIsIt:
          'When you send a bug to the auto-fix agent, Mushi opens a draft pull request on your repo. Each one comes with a one-paragraph rationale and a screenshot diff.',
        useCases: [
          'Review draft PRs before they land — like a junior engineer\u2019s first attempt',
          'See judge scores so you know which fixes are confidence-worthy',
          'Re-run the agent with a different prompt if the first attempt missed',
        ],
        howToUse:
          'Click a fix to open the side-by-side diff. Click "Open PR" to land in GitHub. Click "Re-run" to try again with a fresh draft.',
      },
    },
    '/judge': {
      title: 'Is the classifier getting smarter?',
      description:
        "An independent LLM grades every classification Mushi makes — accuracy, severity, component, repro. This page tracks whether scores are trending up or down.",
      help: {
        title: 'About the AI judge',
        whatIsIt:
          "A second LLM independently grades the classifier's output on every report — was the category right, was the severity right, was the affected component right, and were the repro steps usable. We chart those scores over time so you can tell if the model is improving.",
        useCases: [
          'See whether judge scores are improving week-over-week',
          'Find classifier prompts that produce consistently low scores so you can rewrite them',
          'Catch a regression in the classifier before bad triage decisions ship',
        ],
        howToUse:
          'Click any prompt row in the leaderboard to filter Recent evaluations to just that version. Click any low-score row to inspect the original report and the judge\u2019s reasoning.',
      },
    },
    '/health': {
      title: 'Is the AI brain healthy?',
      description: 'Live latency, error rate, and cost for every LLM call Mushi makes. The vital signs of the auto-fix engine.',
      help: {
        title: 'About system health',
        whatIsIt:
          'Real-time vitals for every LLM call Mushi makes — how fast it responds, how often it fails, and how much each call costs you.',
        useCases: [
          'Catch a slow-down before users notice (p50 / p95 latency trend)',
          'Spot a model outage early (error rate spike)',
          'Watch your daily LLM spend so you don\u2019t blow your budget',
        ],
        howToUse:
          'Switch the time window to compare. Click "Run now" on a cron job to fire it manually. Click any LLM call to open its full trace in Langfuse.',
      },
    },
    '/integrations': {
      title: 'Where fixed bugs go',
      description: 'Connect Sentry, Slack, GitHub, and others so Mushi can route fixes back into the tools your team already uses.',
      sections: {
        platforms: 'Connected services',
        routing: 'Where bugs should land',
      },
      help: {
        title: 'About integrations',
        whatIsIt:
          'Mushi catches bugs and drafts fixes — but you still want them in Sentry, Slack, and your repo. This page wires those routes.',
        useCases: [
          'Send merged fixes back to Sentry so they auto-resolve there',
          'Ping Slack when a critical bug lands',
          'Open draft PRs on the right GitHub repo for each project',
        ],
        howToUse:
          'Click "Configure" on each platform card to paste keys. Click "Test" to verify the connection. The status pill turns green when it\u2019s healthy.',
      },
    },
    '/settings': {
      title: 'Your settings',
      description: 'Project keys, your own LLM API keys, and developer tools.',
      help: {
        title: 'About settings',
        whatIsIt:
          'Project-level configuration: rotate API keys, plug in your own LLM provider keys, and tune developer-only knobs.',
        useCases: [
          'Bring your own Anthropic / OpenAI keys so cost stays on your bill',
          'Test that your keys work before going live',
          'Rotate the project API key if it leaks',
        ],
        howToUse:
          'Use the tabs to navigate. The "Bring your own keys" tab is where you paste LLM provider keys.',
      },
    },
    '/onboarding': {
      title: 'Get Mushi running',
      description: 'Three short steps: create a project, install the widget, send a test bug to see the loop run.',
      help: {
        title: 'About setup',
        whatIsIt:
          'A guided walk-through that gets you from zero to your first auto-drafted fix. Should take about 10 minutes.',
        useCases: [
          'First-time setup of a new project',
          'Add a second project (e.g. staging vs production)',
          'Re-install the widget on a new app',
        ],
        howToUse: 'Follow the steps in order. The checklist tracks your progress automatically.',
      },
    },
  },
  // Advanced mode: terse, jargon-OK. Power users want signal-density and
  // canonical names (PDCA stages, fingerprints, BYOK, air-gap). We override
  // *page subtitles only* — the page-body copy was already written for this
  // audience, so we don't touch sections/help here. Keeping the registry
  // flat makes it obvious what beginner mode adds rather than what it strips.
  advanced: {
    '/': {
      title: 'PDCA cockpit',
      description: 'Plan → Do → Check → Act, with 14d intake, LLM cost, judge trend, fix throughput.',
    },
    '/reports': {
      title: 'Triage queue',
      description: 'Fingerprinted, severity-classified, blast-radius-ranked. Bulk-dispatch eligible rows.',
    },
    '/graph': {
      title: 'Bug graph',
      description: 'Component / page / release adjacency with bug-incidence weighting.',
    },
    '/fixes': {
      title: 'Auto-fix pipeline',
      description: 'Draft PRs from the agent. Judge score + screenshot-diff per attempt.',
    },
    '/judge': {
      title: 'Judge scores',
      description: 'Independent LLM grading with per-prompt regression deltas.',
    },
    '/health': {
      title: 'LLM health',
      description: 'p50/p95 latency, error rate, $/call across providers and chains.',
    },
    '/integrations': {
      title: 'Integrations',
      description: 'Sentry / Slack / GitHub routing + per-platform probe history.',
    },
    '/settings': {
      title: 'Settings',
      description: 'Project keys, BYOK vault, developer toggles.',
    },
    '/onboarding': {
      title: 'Setup wizard',
      description: 'Project → SDK → first report → key rotation.',
    },
  },
}

/**
 * Pulls a page's copy block. Falls back to undefined when no override
 * exists for the active mode, so callers can do
 *   `const copy = usePageCopy('/reports')` and then
 *   `<PageHeader title={copy?.title ?? 'Triage queue'} … />`
 * without a separate beginner/advanced branch in JSX.
 */
export function usePageCopy(path: string): PageCopy | null {
  const { mode } = useAdminMode()
  // Quickstart only overrides 4 routes; everything else falls back to
  // beginner copy (still plain-language) so quickstart users don't see
  // raw advanced jargon when they deep-link into a non-quickstart page.
  if (mode === 'quickstart') {
    return COPY.quickstart[path] ?? COPY.beginner[path] ?? null
  }
  return COPY[mode][path] ?? null
}

/**
 * One-sentence narrative used by <DogfoodNarrativeBanner> to tie the
 * Reports inbox to the user's actual project. Lives here so future
 * projects (not just the glot-it dogfood) inherit the same voice — change
 * the wording in one place and every project gets it. Wave O §2.3.
 */
export function renderDogfoodNarrative(params: {
  projectName: string
  component: string
  componentReports: number
  draftedFixes: number
  mergedFixes: number
}): string {
  const { component, componentReports, draftedFixes, mergedFixes } = params
  const reportsWord = componentReports === 1 ? 'report' : 'reports'
  const headline = `${component} is your most fragile area — ${componentReports} ${reportsWord} in the last 14 days.`

  if (mergedFixes > 0) {
    const merged = mergedFixes === 1 ? '1 fix already merged' : `${mergedFixes} fixes already merged`
    const drafted =
      draftedFixes > mergedFixes
        ? ` and ${draftedFixes - mergedFixes} more drafted.`
        : '.'
    return `${headline} ${merged}${drafted}`
  }
  if (draftedFixes > 0) {
    const drafted = draftedFixes === 1 ? '1 fix drafted' : `${draftedFixes} fixes drafted`
    return `${headline} ${drafted} — ready for your review.`
  }
  return `${headline} No fixes drafted yet — open one and let Mushi try.`
}

/**
 * Plain-language definitions for jargon nouns that show up in tooltips,
 * page-help bodies, and inline `<Jargon term="…">` wrappers. One source of
 * truth — change the wording here and every surface updates.
 */
export const JARGON: Record<string, string> = {
  triage: 'Reviewing new bug reports and deciding what to do with each one.',
  dispatch:
    'Sending a bug report to the auto-fix agent. The agent drafts a pull request for you to review.',
  BYOK:
    'Bring Your Own Keys. Plug in your Anthropic / OpenAI keys so LLM cost stays on your bill, not ours.',
  Vault: 'Encrypted store for your provider keys. Mushi can decrypt them only at request time.',
  pipeline:
    'The chain of LLM calls that turns a raw bug report into a classified, prioritised, auto-fixed PR.',
  'fast-filter':
    'A cheap LLM pass (Haiku) that quickly throws out spam and obvious dupes before anything expensive runs.',
  'classify-report':
    'The LLM step that tags severity, component, blast radius, and likely root cause.',
  'judge-batch':
    'A scheduled run of the LLM judge that grades a batch of recent fixes for quality + screenshot match.',
  fingerprint:
    'A short hash that identifies "the same bug" across multiple reports — used to dedupe.',
  dedup: 'Detecting that two reports are the same underlying bug and merging them into one record.',
  'air-gap':
    'Self-hosted mode where Mushi never calls our cloud — every LLM call goes through your keys, on your infra.',
  'reporter token':
    'A short-lived token the SDK uses to attach a report to the right project without exposing your API key.',
  'PDCA': 'Plan → Do → Check → Act. The four-stage loop Mushi runs every bug through.',
  'judge':
    "A second, independent LLM that grades the classifier's output on every report — accuracy, severity, component, and repro quality.",
}
