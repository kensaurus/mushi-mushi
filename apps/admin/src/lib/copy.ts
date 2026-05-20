/**
 * FILE: apps/admin/src/lib/copy.ts
 * PURPOSE: Plain-language copy registry for beginner mode
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

import { useAdminMode, type AdminMode } from './mode'
import { PAGE_FLOW_LINKS, type PageFlowLink } from './pageLinks'

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
  /** Optional override for cross-page chips (defaults from PAGE_FLOW_LINKS). */
  relatedLinks?: PageFlowLink[]
}

/** Props for `<PageHelp>` with copy + flow fallbacks merged. */
export interface PageHelpFromCopyProps {
  title: string
  whatIsIt: string
  useCases?: string[]
  howToUse?: string
  defaultOpen?: boolean
  relatedLinks?: PageFlowLink[]
}

/**
 * Merge `usePageCopy()` with page-local fallbacks and default flow links.
 * Keeps beginner help in advanced mode while letting each page keep one
 * inline fallback block for titles the registry doesn't override.
 */
export function buildPageHelpProps(
  path: string,
  copy: PageCopy | null,
  fallback: PageHelpFromCopyProps,
) {
  const flow = copy?.relatedLinks ?? fallback.relatedLinks ?? PAGE_FLOW_LINKS[path] ?? []
  return {
    title: copy?.help?.title ?? fallback.title,
    whatIsIt: copy?.help?.whatIsIt ?? fallback.whatIsIt,
    useCases: copy?.help?.useCases ?? fallback.useCases,
    howToUse: copy?.help?.howToUse ?? fallback.howToUse,
    defaultOpen: fallback.defaultOpen,
    relatedLinks: flow.length > 0 ? flow : undefined,
    flowPath: path,
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
  // `usePageCopy`..
  quickstart: {
    '/dashboard': {
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
    '/inbox': {
      title: 'Inbox',
      description: 'Everything waiting for your attention right now. Start here each session.',
      help: {
        title: 'About the inbox',
        whatIsIt:
          'One place to see every action waiting for you — bugs to triage, fixes to review, and setup steps to complete.',
        useCases: [
          'Start every morning here to see what actually needs your attention',
          'Click any open card to jump straight to that page',
        ],
        howToUse:
          'Work through the Awaiting cards top-to-bottom. Green check marks mean nothing to do there.',
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
      description: 'Four guided tabs — create a project, verify the pipeline, install the SDK, and track live checklist progress.',
      help: {
        title: 'About setup',
        whatIsIt: 'DB-backed onboarding wizard — every step reads live project state so progress survives across devices.',
        useCases: [
          'First-time wiring for a new app or environment',
          'Re-mint keys and re-verify ingest after a backend migration',
          'Bookmark the SDK tab when onboarding teammates',
        ],
        howToUse: 'Overview shows posture. Steps runs the checklist. Verify mints keys + sends a test report. SDK holds the install snippet.',
      },
    },
  },
  beginner: {
    '/inbox': {
      title: 'Your to-do list',
      description: 'Start here every session — banner and INBOX SNAPSHOT show open vs clear before you pick Overview, Actions, Stages, or Activity.',
      help: {
        title: 'About the inbox',
        whatIsIt:
          'A tabbed action queue across Plan, Do, Check, Act, and Ops — every card links to the page where you resolve it.',
        useCases: [
          'Read the status banner first — red means open work, green means inbox zero',
          'Use Actions tab as your daily worklist (top to bottom)',
          'Use Stages tab to filter by PDCA phase and confirm cleared surfaces',
          'Activity tab shows the reports and fixes that triggered open cards',
        ],
        howToUse:
          'Overview for posture + top priority. Actions for the queue. Stages for filters. Every primary CTA is live — no dead buttons.',
      },
    },
    '/feedback': {
      title: 'My feedback',
      description: 'Bugs and features you send to the Mushi team — banner and FEEDBACK SNAPSHOT before Overview, Active, Shipped, or All tabs.',
      help: {
        title: 'About My feedback',
        whatIsIt:
          'Your personal ticket inbox for console bugs and product ideas — separate from end-user Reports ingested via SDK.',
        useCases: [
          'Brand banner = team replied — open the ticket to read the thread',
          'Active tab shows open / in-progress tickets with status chips',
          'Shipped tab shows release version when your idea credits in a changelog',
        ],
        howToUse:
          'Report a bug for console issues; Request feature for product ideas. Billing questions go to Billing — not here.',
      },
    },
    '/projects': {
      title: 'Your projects',
      description: 'Create and manage projects — one per app or environment. Each project gets its own bug inbox, API keys, SDK heartbeat, and console scope.',
      help: {
        title: 'About projects',
        whatIsIt: 'A project is a container for one app or environment. Everything in Mushi — bugs, fixes, reports, integrations — belongs to a project.',
        useCases: [
          'Create a project for your main app (takes 30 seconds)',
          'Add a separate project for staging so test bugs don\'t mix with real ones',
          'Generate an API key here, send a test report, and confirm SDK heartbeat before production',
        ],
        howToUse: 'Use Your projects to switch context, mint keys, and read per-project health. Use New project to create one — the banner and KPI strip tell you which projects ingest and which keys have connected.',
      },
    },
    '/queue': {
      title: 'Stuck reports',
      description: 'Bug reports that couldn\'t be processed automatically. Retry them, inspect why they failed, or clear the backlog.',
      help: {
        title: 'About the processing queue',
        whatIsIt: 'A holding area for reports that got stuck during automatic processing — like a jammed printer tray you can fix without losing any pages.',
        useCases: [
          'Retry reports that failed due to a temporary API outage',
          'See exactly why a report got stuck (error message, step, timestamp)',
          'Clear old failures to keep the queue tidy',
        ],
        howToUse: 'Click "Retry" on any failed item. If the same item keeps failing, click it to see the full error details and contact support.',
      },
    },
    '/inventory': {
      title: 'App inventory',
      description: 'Banner + INVENTORY SNAPSHOT — Overview for posture, then User stories, Gates, Discovery, or Yaml tabs.',
      help: {
        title: 'About app inventory',
        whatIsIt:
          "Your app's user-story map — pages, actions, and verification status derived from gates, crawler, and synthetic probes.",
        useCases: [
          'Brand banner = no inventory yet — start on Discovery or paste YAML',
          'Red banner = regressed actions — fix on User stories tab',
          'Amber banner = open gate findings — review on Gates tab',
        ],
        howToUse:
          'Overview for posture. User stories for the card map. Gates for findings. Discovery for SDK observe → propose → accept.',
      },
    },
    '/query': {
      title: 'Ask your data',
      description: 'Natural-language or raw SQL analytics against approved tables — read-only, sandboxed, and logged.',
      help: {
        title: 'About Ask Your Data',
        whatIsIt: 'The LLM writes read-only SQL from plain English, or you paste SELECT statements yourself. Every run is persisted for rerun and audit.',
        useCases: [
          'Answer ad-hoc triage questions without leaving the console',
          'Write precise SQL against approved tables (Raw SQL mode)',
          'Reuse questions pinned by you or teammates',
        ],
        howToUse: 'Overview shows run health. Ask tab runs NL or raw SQL. History tab lists saved/recent/team prompts. Schema tab lists approved tables and $1 project_id binding.',
      },
    },
    '/research': {
      title: 'Web research',
      description: 'Banner + RESEARCH SNAPSHOT — Overview for posture, Search to query Firecrawl, History for sessions.',
      help: {
        title: 'About web research',
        whatIsIt: 'BYOK Firecrawl-powered search you run while triaging a report. Look up release notes, Stack Overflow threads, or vendor changelogs and pin the result to a specific report.',
        useCases: [
          'Cross-reference an error signature against current upstream docs',
          'Find a Stack Overflow thread to attach as triage evidence',
          'Check if a third-party library shipped a fix in the last 24 hours',
        ],
        howToUse: 'Configure Firecrawl in Settings, then search on the Search tab. Paste a report UUID on any snippet and click Attach evidence. Sessions persist per project — reopen them from History.',
      },
    },
    '/repo': {
      title: 'Code connection',
      description: 'Link Mushi to your GitHub repository so auto-fixes can open pull requests directly on your codebase.',
      help: {
        title: 'About repo connection',
        whatIsIt: 'Link your GitHub repo here once, and every auto-fix Mushi drafts will appear as a pull request in the right branch.',
        useCases: [
          'Connect your repo so the auto-fix agent has somewhere to open PRs',
          'Check connection health if PRs stopped appearing',
          'Switch to a different repo or branch',
        ],
        howToUse: 'Click "Connect GitHub" and follow the OAuth flow. Once connected, a green pill confirms auto-fixes will land in your repo.',
      },
    },
    '/sso': {
      title: 'Single sign-on',
      description: 'Register SAML IdPs for team login — ACS URL, domain routing, and GoTrue registration status.',
      help: {
        title: 'About single sign-on',
        whatIsIt: 'Enterprise SSO via Supabase Auth. SAML 2.0 self-registers through GoTrue; OIDC configs are audit-only until Supabase support provisions the tenant.',
        useCases: [
          'Let Okta or Azure AD authenticate admins instead of email/password',
          'Map email domains so the right IdP handles each login',
          'Audit registration failures before enforcing SSO-only access',
        ],
        howToUse: 'Setup tab adds a provider. Overview shows the ACS URL to paste into your IdP. Providers tab lists status and errors. Test with a non-admin user before locking password login.',
      },
    },
    '/audit': {
      title: 'Audit log',
      description: 'Append-only mutation trail — human, agent, and system actors with CSV export for compliance reviews.',
      help: {
        title: 'About the audit log',
        whatIsIt: 'Tamper-proof record of every consequential action: report triage, key rotation, settings saves, fix dispatch, and compliance events.',
        useCases: [
          'Answer "who changed this setting" or "when was this key revoked"',
          'Filter failures (fix.failed) before a SOC 2 review',
          'Export the current filter view as CSV evidence',
        ],
        howToUse: 'Overview shows posture + hero. Log tab stacks filters and expands metadata JSON. Breakdown tab surfaces 24h actor mix and top 7-day actions.',
      },
    },
    '/prompt-lab': {
      title: 'Prompt editor',
      description: 'Edit the instructions that tell the AI how to classify bugs and draft fixes. Improve accuracy without any code changes.',
      help: {
        title: 'About the prompt editor',
        whatIsIt: 'A live editor where you can tune the instructions the AI uses — like telling a new employee how you want bugs described.',
        useCases: [
          'Fix a prompt that\'s consistently mis-labelling severity or category',
          'Run a test against real past reports before publishing a change',
          'Compare two prompt versions side-by-side to find the better one',
        ],
        howToUse: 'Pick a prompt stage, edit the text, then click "Test" to see results against real reports before saving.',
      },
    },
    '/intelligence': {
      title: 'Bug Intelligence',
      description: 'Banner + INTELLIGENCE SNAPSHOT — Overview for posture, Reports for digests, Pipeline for jobs and findings.',
      help: {
        title: 'About Bug Intelligence',
        whatIsIt: 'Weekly LLM-authored digest of your bug pipeline — trends, fix velocity, hotspots, and recommendations. Each report is persisted, versioned, and exportable as HTML/PDF.',
        useCases: [
          'Share a one-page status with stakeholders every Monday',
          'Spot regressions early — week-over-week category and severity drift',
          'Compare fix velocity against anonymised industry benchmarks (opt-in)',
        ],
        howToUse: 'Reports generate automatically every Monday by cron. Click Generate to run for the current project — Pipeline shows live job status and errors for debugging.',
      },
    },
    '/compliance': {
      title: 'Compliance',
      description: 'SOC 2 evidence vault, retention windows, DSAR queue, and data residency — scoped to the active project.',
      help: {
        title: 'About compliance',
        whatIsIt: 'SOC 2 Type 1 readiness — nightly control evidence, per-project retention, legal hold, GDPR/CCPA DSAR audit trail, and regional pinning.',
        useCases: [
          'Show auditors the latest pass/warn/fail snapshot per control',
          'Place a project on legal hold before litigation or discovery',
          'File and fulfil data-subject requests within the 30-day SLA',
        ],
        howToUse: 'Start on Overview for posture + severity filters. Evidence tab expands payload JSON. Retention tab tunes day windows. DSARs tab files requests. Residency pins US/EU/JP before data lands.',
      },
    },
    '/storage': {
      title: 'BYO storage',
      description: 'Per-project bucket configuration for screenshots and attachments — Supabase default or your own S3, R2, GCS, or MinIO.',
      help: {
        title: 'About BYO storage',
        whatIsIt: 'Each project can pin uploads to your own object store. Defaults to the cluster Supabase bucket until you save an override.',
        useCases: [
          'Route screenshots to AWS for invoice consolidation',
          'Use Cloudflare R2 to cut egress on heavy report volumes',
          'Self-host with MinIO inside an air-gapped network',
        ],
        howToUse: 'Overview shows bucket health. Configure saves provider + Vault refs. Usage lists screenshot counts. Health check runs a write probe with step-by-step debug output.',
      },
    },
    '/marketplace': {
      title: 'Marketplace',
      description: 'Banner + MARKETPLACE SNAPSHOT — Overview for posture, Browse to install, Deliveries to debug webhooks.',
      help: {
        title: 'About the marketplace',
        whatIsIt: 'Webhook plugins subscribe to Mushi lifecycle events. Every POST is signed so your receiver can verify authenticity before acting.',
        useCases: [
          'Page on-call via PagerDuty when a critical bug is reported',
          'Mirror classified reports to Linear or Jira automatically',
          'Fan out events to Zapier or Make for no-code workflows',
        ],
        howToUse: 'Browse the catalog, deploy a receiver, click Install, paste your HTTPS URL, and copy the signing secret when shown.',
      },
    },
    '/mcp': {
      title: 'MCP — agent connection',
      description: 'Banner + MCP SNAPSHOT — Overview for posture, Setup for snippet, Catalog for tools and resources.',
      help: {
        title: 'About MCP (AI agent connection)',
        whatIsIt: 'MCP lets your coding assistant call Mushi tools during a chat — read reports, dispatch fixes, and query production data without copy-pasting IDs.',
        useCases: [
          'Ask Cursor "what should I fix next?" and get an answer from your real bugs',
          'Have the agent draft a fix for a specific report in one command',
          'Query your bug data in plain English from inside your editor',
        ],
        howToUse: 'Generate an mcp:read key on /projects, copy the snippet on this page, restart your IDE, then ask "list mushi tools".',
      },
    },
    '/qa-coverage': {
      title: 'Automated QA tests',
      description: 'Write user-story tests in plain English, run them on a schedule, and catch regressions before your users do.',
      help: {
        title: 'About QA coverage',
        whatIsIt: 'Automated tests written in plain English that run on your live app on a schedule — like hiring a robot QA tester that never sleeps.',
        useCases: [
          'Write a test like "A user can log in and see their dashboard" and run it every hour',
          'Catch a broken flow before users report it',
          'See a screenshot of what the test saw when it failed',
        ],
        howToUse: 'Click "New story" to write a test in plain English. Set a schedule. Click "Run now" to test immediately. Red = something broke.',
      },
    },
    '/anti-gaming': {
      title: 'Spam controls',
      description: 'Detect and block fake or spammy bug reports so your inbox stays clean and your credits aren\'t wasted.',
      help: {
        title: 'About spam controls',
        whatIsIt: 'Automatic filters that catch fake, duplicate, or deliberately spammy reports before they waste your credits or clog your inbox.',
        useCases: [
          'Review flagged devices that are sending suspicious reports',
          'Unblock a real user who was incorrectly flagged',
          'Tune sensitivity so the filter catches more (or fewer) reports',
        ],
        howToUse: 'Flagged devices appear in the list with the reason. Click any row to review. Use "Unflag" if the block was a false positive.',
      },
    },
    '/rewards': {
      title: 'Rewards program',
      description: 'Banner + REWARDS SNAPSHOT — Overview for 24h feed, Rules/Tiers to configure, Settings for webhooks and disputes.',
      help: {
        title: 'About rewards',
        whatIsIt: 'Org-scoped loyalty loop: SDK activity → points → tiers → perks (Pro access, payouts, host webhooks).',
        useCases: [
          'Reward beta testers with tier perks when they file quality bug reports',
          'Use the 24h activity feed on Overview to debug rejected SDK events',
          'Simulate a user journey on Sandbox before changing rule caps in production',
        ],
        howToUse: 'Enable rewards on the project, configure Activity rules + Tier ladder, then call SDK identify() and activity(). Settings tab holds webhooks and identity providers.',
      },
    },
    '/lessons': {
      title: 'Learned rules',
      description: 'Banner + LESSONS SNAPSHOT — Overview for posture, Lessons for promoted rules, Clusters to promote, Query Sim to preview injection.',
      help: {
        title: 'About lessons',
        whatIsIt: 'Rules automatically extracted from recurring bugs. Once a pattern appears enough times, Mushi names it and uses it to catch the next one early.',
        useCases: [
          'See what classes of bugs keep coming back in your project',
          'Use these rules in AI code review so the agent knows your history',
          'Export lessons to a file so your whole team\'s tools share them',
        ],
        howToUse: 'Lessons are created automatically. Click any lesson to read the full rule and see which past reports triggered it.',
      },
    },
    '/releases': {
      title: 'Releases',
      description: 'Banner + RELEASES SNAPSHOT — Overview for posture, Drafts/Published to manage, Draft to generate with AI.',
      help: {
        title: 'About Releases',
        whatIsIt: 'Release drafts scan fixed bug reports from a time window, attribute them to reporters, and write a plain-English changelog using AI.',
        useCases: [
          'Auto-generate changelogs linked to the users who reported each fix',
          'Notify credited reporters in the feedback stamp when you publish',
          'Close the feedback loop: users see what their reports fixed',
        ],
        howToUse: 'Select a date window and click Generate draft — AI writes the changelog. Review credited contributors, edit if needed, then publish to queue in-app toasts for each reporter.',
      },
    },
    '/iterate': {
      title: 'PDCA iteration',
      description: 'Banner + PDCA SNAPSHOT — Overview for posture, Runs to trigger loops, New Run to queue.',
      help: {
        title: 'About PDCA iteration',
        whatIsIt: 'Each run fetches a live page, generates improved markup (producer), then scores it with an LLM critic persona. The loop repeats until the target score or max iterations.',
        useCases: [
          'Improve a dashboard page\'s visual hierarchy automatically',
          'Run a WCAG accessibility critique cycle on a live URL',
          'Use a conversion persona to suggest CTA and copy improvements',
        ],
        howToUse: 'Overview shows pipeline posture. Queue on New Run, Trigger queued rows on Runs, open a run for score timeline and critique export.',
      },
    },
    '/drift': {
      title: 'Contract drift',
      description: 'Banner + DRIFT SNAPSHOT — compare OpenAPI, inventory, and DB schema to catch gaps before users do.',
      help: {
        title: 'About contract drift',
        whatIsIt: 'The drift-walker builds a contract snapshot then walks every route — finding API endpoints, inventory nodes, or DB columns that diverged from each other.',
        useCases: [
          'Find API endpoints present in inventory but missing in OpenAPI spec',
          'Detect DB columns expected by the FE but removed from the schema',
          'Promote high-severity findings to candidate lessons',
        ],
        howToUse: 'Run a scan from the Scanner tab, then triage findings. Dismiss false positives to train the sampler.',
      },
    },
    '/experiments': {
      title: 'A/B experiments',
      description: 'Banner + EXPERIMENTS SNAPSHOT — create variants, launch tests, analyze with mSPRT significance.',
      help: {
        title: 'About experiments',
        whatIsIt: 'A/B testing with SDK assignment — compare UI variants with CUPED variance reduction, mSPRT always-valid p-values, and SRM checks.',
        useCases: [
          'Test button copy, colour, or layout variants',
          'Measure impact of a new feature on conversion rate',
          'Use bandit mode for fast exploration with small samples',
        ],
        howToUse: 'Create an experiment, add variants, launch it. The SDK assigns users via mushi.experiment(). Analyze at any time — mSPRT prevents false positives.',
      },
    },
    '/anomalies': {
      title: 'Metric anomalies',
      description: 'Banner + ANOMALIES SNAPSHOT — ingest metrics, run detection, triage Page-Hinkley and release regressions.',
      help: {
        title: 'About anomaly detection',
        whatIsIt: 'Ingest any numeric metric (error rate, latency, conversion) and run Page-Hinkley, Z-score, or release-regression detectors. Confirmed regressions can auto-open bug reports.',
        useCases: [
          'Detect crash-rate spikes after a release',
          'Flag latency regressions against rolling baseline',
          'Auto-open a bug report when a regression is confirmed',
        ],
        howToUse: 'Ingest metric data in the Metrics tab, then run detection or wait for the hourly cron. Confirm or dismiss each finding.',
      },
    },
    '/cost': {
      title: 'LLM Cost',
      description: 'Audit every AI call — spend by operation, model, and day with a searchable invocation log.',
      help: {
        title: 'About AI cost tracking',
        whatIsIt: 'Every edge function writes to llm_invocations with token counts and cost_usd. This page rolls spend up by operation, model, and day — legacy llm_cost_usd rows are merged into totals.',
        useCases: [
          'See which classify/fix/judge step costs the most before tuning prompts',
          'Spot a runaway cron from the 24h spend banner or daily chart',
          'Confirm BYOK vs platform key usage before your billing cycle',
        ],
        howToUse: 'Overview shows health + trend. Breakdown groups by operation/model. Raw log searches individual calls. Add Anthropic BYOK in Settings → LLM keys to bill your own key.',
      },
    },
    '/notifications': {
      title: 'Reporter notifications',
      description: 'Outbound messages the SDK widget polls — classify, fix, and reward updates for bug reporters.',
      help: {
        title: 'About reporter notifications',
        whatIsIt: 'Messages queued for end users who submitted bugs. The SDK polls this inbox so reporters see when their report was classified, fixed, or rewarded.',
        useCases: [
          'Verify the reporter widget is receiving classify/fix updates',
          'Audit which reporter tokens were notified for a given report',
          'Debug stale unread rows when client polling stops',
        ],
        howToUse: 'Filter by type or unread, expand payloads to inspect JSON, mark read when verified. Requires reporter_notifications_enabled in Settings.',
      },
    },
    '/billing': {
      title: 'Plan & billing',
      description: 'Current plan, quota usage, Stripe invoices, and upgrade paths — scoped to the active project.',
      help: {
        title: 'About billing',
        whatIsIt: 'Per-project subscription and usage meters. Hobby includes a monthly report quota; paid plans unlock higher limits, BYOK, and Stripe-managed billing.',
        useCases: [
          'See reports used vs quota before ingest starts returning HTTP 402',
          'Upgrade via Stripe Checkout or manage card/invoices in the Billing Portal',
          'Cross-check Mushi usage (reports, fixes, LLM COGS) against Stripe line items',
        ],
        howToUse: 'Overview shows your project card with usage bar and invoices. Plans compares tiers. Support opens a ticket. Status banner explains quota and payment health at a glance.',
      },
    },
    '/organization/members': {
      title: 'Team members',
      description: 'Invite colleagues, assign roles, and audit seat activity — scoped to the team in the header org switcher.',
      help: {
        title: 'About team management',
        whatIsIt: 'Invite teammates, set what each person can see or change, and remove access when someone leaves the team.',
        useCases: [
          'Invite a colleague with their email address (they get a link)',
          'Give a designer read-only access so they can see bugs without changing anything',
          'Filter inactive seats before renewing a capped plan',
        ],
        howToUse: 'Roster shows activity and roles. Invites sends email and surfaces pending accept links. Setup renames the team and shows plan limits.',
      },
    },
    '/explore': {
      title: 'Codebase map',
      description: 'Banner + EXPLORE SNAPSHOT — Overview for posture, Graph/Layers/Search for the atlas, Index for debug.',
      help: {
        title: 'About the codebase explorer',
        whatIsIt: 'A visual map of your code that shows every file, how files connect, and lets you search with plain English.',
        useCases: [
          'Red banner = index error; brand = indexing off or in progress',
          'Graph tab: canvas coloured by UI / Backend / Test layer',
          'Search tab: semantic lookup once embeddings are populated',
        ],
        howToUse: 'Overview for posture. Graph/Layers for the map. Search for plain-English lookup. Index tab when debugging sweeper errors.',
      },
    },
    '/users': {
      title: 'User directory',
      description: 'Operator-only view of all signups, plans, and activity. Useful for support and growth tracking.',
      help: {
        title: 'About the user directory',
        whatIsIt: 'A full list of every Mushi account — visible only to operators — showing signup date, plan, and recent activity.',
        useCases: [
          'Look up a specific user to check their plan or recent activity',
          'See how many new users signed up this week',
          'Find accounts that signed up but never submitted a report',
        ],
        howToUse: 'Search by email or filter by plan. Click any row for the full user detail. This page is only visible to super-admins.',
      },
    },
    '/dashboard': {
      title: 'Your bug-fix loop',
      description: 'Live workspace snapshot — banner and KPI strip tell you what needs action before you drill into loop, metrics, or health.',
      help: {
        title: 'How to read this dashboard',
        whatIsIt:
          'A live picture of bugs your users hit, fixes Mushi drafted, judge scores, and where fixes shipped — organized into Overview, Loop, Metrics, and Health tabs.',
        useCases: [
          'Glance at the status banner to see backlog, failures, or integration issues',
          'Use Loop tab for the interactive PDCA canvas with live counts',
          'Use Metrics for 14-day charts and the triage queue',
          'Use Health for platform probes and QA coverage on the active project',
        ],
        howToUse:
          'Start on Overview. Click any KPI tile or tab badge to jump to the stage that needs attention. Green banner = loop healthy.',
      },
    },
    '/reports': {
      title: 'Bugs your users felt',
      description: 'Banner + TRIAGE SNAPSHOT first — then Overview for posture, Queue to triage, Severity for 14d trends.',
      sections: {
        triage_queue: 'Waiting for review',
      },
      help: {
        title: 'About reports',
        whatIsIt:
          'A list of bugs your end-users flagged, automatically grouped, scored, and ranked by how many people are affected.',
        useCases: [
          'Read the status banner — red = critical untriaged, green = queue current',
          'Queue tab: j/k navigate, bulk dismiss, dispatch fixes',
          'Severity tab: 14d sparklines — click a tile to filter the queue',
        ],
        howToUse:
          'Overview for posture + top priority. Queue for the sortable table. Severity for trends. Refresh reloads stats + list.',
      },
    },
    '/graph': {
      title: 'How bugs connect',
      description: 'Banner + GRAPH SNAPSHOT — Overview for posture, Explore for the map, Backend for AGE sync debug.',
      help: {
        title: 'About the bug map',
        whatIsIt:
          'Every bug points at a component, page, or release. This map joins those dots so you can see where breakage clusters.',
        useCases: [
          'Red banner = fragile components (≥3 incoming affects edges)',
          'Explore tab: canvas, table, or inventory surface — click nodes for blast radius',
          'Backend tab: Apache AGE sync status and ontology groups',
        ],
        howToUse:
          'Overview for posture. Explore for quick views (Fragile, Regressions, Fixes). Backend when debugging sync drift.',
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
      description: 'Connect Sentry, Langfuse, GitHub, and routing destinations so Mushi closes the loop in tools your team already uses.',
      sections: {
        platforms: 'Connected services',
        routing: 'Where bugs should land',
      },
      help: {
        title: 'About integrations',
        whatIsIt:
          'Mushi catches bugs and drafts fixes — but you still want them in Sentry, your repo, and your tracker. Wire platform credentials here, then add routing destinations.',
        useCases: [
          'Give the LLM Sentry context when classifying user reports',
          'Let auto-fix open draft PRs on your GitHub repo',
          'Forward critical triage to Jira, Linear, or PagerDuty',
        ],
        howToUse:
          'Use the Platform tab to paste keys and Test each card. Routing tab connects ticketing tools. Repo & index covers RAG indexing for auto-fix.',
      },
    },
    '/integrations/config': {
      title: 'Integrations',
      description: 'Connect Sentry, Langfuse, GitHub, and routing destinations so Mushi closes the loop in tools your team already uses.',
      sections: {
        platforms: 'Platform wiring',
        routing: 'Routing destinations',
        repo: 'Repo & codebase index',
      },
      help: {
        title: 'About integrations',
        whatIsIt:
          'Mushi uses your existing observability + code tools. Platform cards feed the LLM pipeline; routing forwards triaged reports; Repo & index grounds auto-fix in your codebase.',
        useCases: [
          'Give the LLM Sentry context when classifying user reports',
          'Let auto-fix open draft PRs on your GitHub repo',
          'Forward critical triage to Jira, Linear, or PagerDuty',
        ],
        howToUse:
          'Platform tab: Edit credentials → Test. Routing tab: connect ticketing tools. Repo & index: enable codebase indexing before dispatching fixes.',
      },
    },
    '/settings': {
      title: 'Project settings',
      description: 'Per-project pipeline knobs — LLM keys, SDK widget, Slack/Sentry hooks, and dev flags for the active project.',
      help: {
        title: 'About settings',
        whatIsIt:
          'Project-level configuration scoped to the header project: BYOK LLM keys, classifier model, dedup threshold, SDK widget, and developer toggles.',
        useCases: [
          'Bring your own Anthropic / OpenAI keys so cost stays on your bill',
          'Run Health → Send test report before wiring production SDK traffic',
          'Tune Stage-2 model and dedup threshold after you see false positives in triage',
        ],
        howToUse:
          'General saves Slack/Sentry + classifier fields. LLM keys tab tests BYOK. Health runs a pipeline smoke test. Changes write to project_settings immediately on Save.',
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
    '/inbox': {
      title: 'Inbox',
      description: 'Cross-stage action queue — INBOX SNAPSHOT KPIs, then Overview | Actions | Stages | Activity tabs.',
    },
    '/feedback': {
      title: 'My feedback',
      description: 'Support ticket inbox — FEEDBACK SNAPSHOT KPIs, then Overview | Active | Shipped | All tabs.',
    },
    '/projects': {
      title: 'Projects',
      description: 'Multi-tenant project registry — API keys, SDK heartbeat, per-project deep links.',
    },
    '/queue': {
      title: 'Processing queue',
      description: 'DLQ + stuck pipeline items. Retry, inspect failure stage, flush backlog.',
    },
    '/inventory': {
      title: 'Inventory',
      description: 'Banner + INVENTORY SNAPSHOT — Overview | User stories | Tree | Gates | Discovery | Yaml tabs.',
    },
    '/query': {
      title: 'Ask Your Data',
      description: 'NL + raw SQL analytics — saved history, team pins, 24h error/latency stats.',
    },
    '/research': {
      title: 'Research',
      description: 'Banner + RESEARCH SNAPSHOT — Overview for posture, Search to query Firecrawl, History for sessions.',
    },
    '/repo': {
      title: 'Repo',
      description: 'GitHub OAuth, default branch, fix-worker target repo health.',
    },
    '/sso': {
      title: 'SSO',
      description: 'SAML GoTrue registration, domain routing, and provider health per project.',
    },
    '/audit': {
      title: 'Audit log',
      description: 'Append-only mutation trail — human + agent actors, filter stack, CSV export.',
    },
    '/prompt-lab': {
      title: 'Prompt lab',
      description: 'Versioned classifier/fix prompts with shadow tests on live reports.',
    },
    '/intelligence': {
      title: 'Intelligence',
      description: 'Banner + INTELLIGENCE SNAPSHOT — Overview for posture, Reports for digests, Pipeline for jobs and findings.',
    },
    '/compliance': {
      title: 'Compliance',
      description: 'Retention, evidence vault, DSAR queue, and residency controls.',
    },
    '/storage': {
      title: 'Storage',
      description: 'Per-project BYO bucket config — health probes, Vault refs, usage counts.',
    },
    '/marketplace': {
      title: 'Marketplace',
      description: 'Webhook plugin catalog, installs, and signed delivery log per project.',
    },
    '/mcp': {
      title: 'MCP',
      description: 'Banner + MCP SNAPSHOT — Overview for key posture, Setup for IDE snippet, Catalog for tools.',
    },
    '/qa-coverage': {
      title: 'QA coverage',
      description: 'Banner + QA SNAPSHOT — Overview for posture, Stories for all tests, Failing for sub-80% pass rate.',
    },
    '/anti-gaming': {
      title: 'Anti-gaming',
      description: 'Heuristics for synthetic / duplicate / low-signal report abuse.',
    },
    '/rewards': {
      title: 'Rewards',
      description: 'Banner + REWARDS SNAPSHOT — Overview for 24h SDK feed, Rules/Tiers to configure, Settings for webhooks.',
    },
    '/lessons': {
      title: 'Lessons',
      description: 'Banner + LESSONS SNAPSHOT — Overview for posture, Lessons for rules, Clusters to promote, Query Sim to preview injection.',
    },
    '/releases': {
      title: 'Releases',
      description: 'Banner + RELEASES SNAPSHOT — Overview for posture, Drafts/Published to manage, Draft to generate with AI.',
    },
    '/iterate': {
      title: 'Iterate',
      description: 'PDCA producer/critic loops on target URLs — queue, trigger, inspect critiques.',
    },
    '/drift': {
      title: 'Drift',
      description: 'Banner + DRIFT SNAPSHOT — Overview for posture, Findings to triage, Snapshots for history, Scanner to run walker.',
    },
    '/experiments': {
      title: 'Experiments',
      description: 'Banner + EXPERIMENTS SNAPSHOT — Overview for posture, Experiments to launch/monitor, New to create variants.',
    },
    '/anomalies': {
      title: 'Anomalies',
      description: 'Banner + ANOMALIES SNAPSHOT — Overview for posture, Anomalies to triage, Metrics to ingest, Detect to run analysis.',
    },
    '/cost': {
      title: 'LLM Cost',
      description: 'Per-project llm_invocations telemetry — spend rollups, breakdown, and raw log.',
    },
    '/notifications': {
      title: 'Reporter notifications',
      description: 'SDK widget inbox — classify, fix, and reward messages scoped per project.',
    },
    '/billing': {
      title: 'Billing',
      description: 'Plan entitlements, usage meters, Stripe subscription state, and support tickets.',
    },
    '/organization/members': {
      title: 'Members',
      description: 'Org roster, roles (viewer → owner), invite lifecycle.',
    },
    '/explore': {
      title: 'Codebase atlas',
      description: 'Banner + EXPLORE SNAPSHOT — Overview | Graph | Layers | Search | Index. Indexed file graph + semantic search.',
    },
    '/users': {
      title: 'Users',
      description: 'Operator directory — signups, plans, last-seen activity.',
    },
    '/dashboard': {
      title: 'PDCA cockpit',
      description: 'Plan → Do → Check → Act — banner + LOOP SNAPSHOT KPIs, then Overview | Loop | Metrics | Health tabs.',
    },
    '/reports': {
      title: 'Triage queue',
      description: 'Banner + TRIAGE SNAPSHOT — Overview | Queue | Severity tabs. Fingerprinted, severity-classified, blast-radius-ranked.',
    },
    '/graph': {
      title: 'Bug graph',
      description: 'Banner + GRAPH SNAPSHOT — Overview | Explore | Backend. Component/page adjacency with bug-incidence weighting.',
    },
    '/fixes': {
      title: 'Auto-fix pipeline',
      description: 'Draft PRs from the agent. Judge score + screenshot-diff per attempt.',
    },
    '/judge': {
      title: 'Judge scores',
      description: 'Banner + JUDGE SNAPSHOT — Overview for posture, Trend for 12w chart, Evaluations for per-report grades.',
    },
    '/health': {
      title: 'LLM health',
      description: 'Banner + HEALTH SNAPSHOT — Overview for posture, LLM for breakdowns, Cron for jobs, Activity for traces.',
    },
    '/integrations': {
      title: 'Integrations',
      description: 'Sentry / Langfuse / GitHub platform wiring + Jira/Linear/PagerDuty routing.',
    },
    '/integrations/config': {
      title: 'Integrations',
      description: 'Platform probes, routing destinations, and codebase index readiness per project.',
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

/** Merge advanced overrides onto beginner base so help/sections survive mode switch. */
function mergePageCopy(path: string, mode: AdminMode): PageCopy | null {
  const beginner = COPY.beginner[path]
  if (mode === 'quickstart') {
    return COPY.quickstart[path] ?? beginner ?? null
  }
  if (mode === 'beginner') {
    return beginner ?? null
  }
  const advanced = COPY.advanced[path]
  if (!advanced && !beginner) return null
  if (!advanced) return beginner ?? null
  if (!beginner) return advanced
  return {
    ...beginner,
    ...advanced,
    sections: { ...beginner.sections, ...advanced.sections },
    help: advanced.help ?? beginner.help,
  }
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
  return mergePageCopy(path, mode)
}

/**
 * One-sentence narrative used by <DogfoodNarrativeBanner> to tie the
 * Reports inbox to the user's actual project. Lives here so future
 * projects (not just the glot-it dogfood) inherit the same voice — change
 * the wording in one place and every project gets it. §2.3.
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
