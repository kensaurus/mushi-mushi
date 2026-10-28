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
import { type PageFlowLink } from './pageLinks'

interface PageCopy {
  /** Page-header title (overrides the in-page title in beginner mode). */
  title?: string
  /** Page-header sub-description. */
  description?: string
  /** Section header rewrites (sectionId → title). */
  sections?: Record<string, string>
  /** StatCard label overrides for snapshot strips. */
  statLabels?: Record<string, string>
  /** Primary row action button labels. */
  actionLabels?: Record<string, string>
  /** Status bucket pill labels (Fixes page). */
  bucketLabels?: Record<string, string>
  /** Tab labels for simplified wizards. */
  tabLabels?: Record<string, string>
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

interface CopyRegistry {
  quickstart: Record<string, PageCopy>
  beginner: Record<string, PageCopy>
  advanced: Record<string, PageCopy>
}

const COPY: CopyRegistry = {
  // Quickstart mode: only 3 routes are surfaced in the sidebar (Inbox /
  // Drafts / Setup), so we override copy on just those plus the dashboard
  // landing. Everything else falls through to beginner copy via
  // `usePageCopy`..
  quickstart: {
    '/dashboard': {
      title: 'Home',
      description: 'How your app is doing: is it up, what needs you, and what is shipping.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        backlog: 'Waiting',
        reports: 'Bugs this week',
        fixes: 'Fixes running',
        focus: 'Focus',
      },
      actionLabels: {
        setup: 'Finish setup',
        triage: 'Review bugs',
        failed: 'Retry fixes',
        health: 'Check connections',
        verify: 'Send test bug',
        healthy: 'View loop',
        refresh: 'Refresh',
      },
      tabLabels: { overview: 'Home' },
      help: {
        title: 'About your home screen',
        whatIsIt:
          'One page per app: whether it is up, what needs you, what is shipping, and which pages have bugs.',
        useCases: [
          'Start every session here to see what actually needs you',
          'Check the site is up and CI on main is green',
          'Finish setup while the grey lights say what to connect',
        ],
        howToUse:
          'Every number opens the list it counts. A grey light is not connected yet; its button says how to connect it.',
      },
    },
    '/inbox': {
      title: 'To-do',
      description: 'Open items across Plan, Do, Check, and Act — start here each session.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        open: 'Waiting',
        clear: 'Done',
        backlog: 'Old bugs',
        critical: 'Urgent bugs',
      },
      actionLabels: {
        setup: 'Finish setup',
        queue: 'See queue',
        // Not "Fix now": the top action is often a quality check or setup
        // step, and the label must not promise a fix it won't start.
        takeAction: 'Start now',
        stages: 'See stages',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        actions: 'To-do',
        stages: 'By type',
        activity: 'Recent',
      },
      help: {
        title: 'About the to-do list',
        whatIsIt:
          'One place to see every action waiting for you — bugs to review, fixes to check, and setup steps to finish.',
        useCases: [
          'Start every morning here to see what actually needs your attention',
          'Click any open card to jump straight to that page',
        ],
        howToUse:
          'Work through the Awaiting cards top-to-bottom. Green check marks mean nothing to do there.',
      },
    },
    '/reports': {
      title: 'Bugs',
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
        howToUse: 'Click any bug to open the full proof. Click "Dispatch fix" to draft a pull request.',
      },
    },
    '/fixes': {
      title: 'Fixes',
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
      title: 'Set up',
      description: 'Three steps: create your app, send a test bug, paste the widget snippet.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        required: 'Progress',
        sdk: 'Widget',
        reports: 'Test bugs',
        optional: 'Extras',
      },
      tabLabels: {
        steps: 'Create app',
        verify: 'Test it',
        sdk: 'Install widget',
        diagnose: 'Fix a problem',
      },
      help: {
        title: 'About setup',
        whatIsIt:
          'A guided checklist that reads live project state — create your app, send a test bug, and install the widget. Progress saves across devices.',
        useCases: [
          'First-time wiring for a new app or environment',
          'Mint a fresh key and re-test after moving backends',
          'Share the SDK tab when onboarding teammates',
        ],
        howToUse:
          'Overview shows posture. Steps runs the checklist. Verify mints keys and sends a test report. SDK holds the install snippet.',
      },
    },
  },
  beginner: {
    '/inbox': {
      title: 'To-do',
      description: 'Start here every session — banner shows what needs you before you open the queue.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        open: 'Open',
        clear: 'Clear',
        backlog: 'Backlog',
        critical: 'Critical 14d',
      },
      actionLabels: {
        setup: 'Continue setup',
        queue: 'View queue',
        takeAction: 'Take action',
        stages: 'View stages',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Overview',
        actions: 'Actions',
        stages: 'Stages',
        activity: 'Activity',
      },
      help: {
        title: 'About the to-do list',
        whatIsIt:
          'A tabbed action queue across Plan, Do, Check, Act, and Ops — every card links to the page where you resolve it.',
        useCases: [
          'Read the status banner first — red means open work, green means inbox zero',
          'Use Actions tab as your daily worklist (top to bottom)',
          'Use Stages tab to filter by loop phase and confirm cleared surfaces',
          'Activity tab shows the reports and fixes that triggered open cards',
        ],
        howToUse:
          'Overview for posture + top priority. Actions for the queue. Stages for filters. Every primary CTA is live — no dead buttons.',
      },
    },
    '/feedback': {
      title: 'Help & support',
      description: 'Your support tickets to the Mushi team — banner and FEEDBACK SNAPSHOT before Overview, Active, Shipped, or All tabs.',
      help: {
        title: 'About Help & support',
        whatIsIt:
          'Your personal ticket inbox for console bugs and product ideas — separate from end-user reports sent through the SDK.',
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
      title: 'Manage apps',
      description: 'Banner shows what needs you — then Overview for the big picture, Your projects to create apps and copy keys.',
      help: {
        title: 'About managing apps',
        whatIsIt: 'A project is a container for one app or environment. Everything in Mushi — bugs, fixes, reports, integrations — belongs to a project.',
        useCases: [
          'Create a project for your main app (takes 30 seconds)',
          'Add a separate project for staging so test bugs don\'t mix with real ones',
          'Generate an API key here, send a test report, and confirm SDK heartbeat before production',
        ],
        howToUse:
          'Use Your projects to switch apps, mint keys, and read per-project health. Use New project to create one — the banner tells you which apps are receiving reports and which keys are connected.',
      },
    },
    '/queue': {
      title: 'Processing jobs',
      description: 'Bug reports that couldn\'t be processed automatically. Retry them, inspect why they failed, or clear the backlog.',
      help: {
        title: 'About processing jobs',
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
      title: 'User stories',
      description:
        'Every page of your app and what users do on it, with broken actions in red.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        verified: 'Verified',
        regressed: 'Regressed',
        findings: 'Findings',
        discovery: 'Discovery',
      },
      actionLabels: {
        setup: 'Go to Setup',
        discovery: 'Open Discovery',
        proposal: 'Review proposal',
        stories: 'View stories',
        gates: 'Show code checks',
        tree: 'Show all actions',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        stories: 'User stories',
        tree: 'All actions',
        gates: 'Code checks',
        synthetic: 'Live probes',
        drift: 'Out of sync',
        discovery: 'Discovery',
        yaml: 'Map file',
      },
      help: {
        title: 'About user stories',
        whatIsIt:
          "Your app's map: each page, what users do on it, and whether each action still works, from code checks, the crawler and live probes.",
        useCases: [
          'No map yet: click Turn on discovery',
          'Red actions: they stopped working or have no code behind them yet',
          'Open code findings: review them on the Code checks tab',
        ],
        howToUse:
          'User stories leads with each page and its actions. Code checks lists findings. Discovery drafts the map from what the SDK sees.',
      },
    },
    '/query': {
      title: 'SQL query',
      description: 'Ask questions in plain English or paste read-only SQL — every run is logged for your team.',
      help: {
        title: 'About SQL query',
        whatIsIt: 'Ask questions in plain English and get read-only SQL results, or paste SELECT statements yourself. Every run is saved for rerun and audit.',
        useCases: [
          'Answer ad-hoc questions about bugs and fixes without leaving the console',
          'Write precise SQL against approved tables (Raw SQL mode)',
          'Reuse questions pinned by you or teammates',
        ],
        howToUse: 'Overview shows run health. Ask tab runs plain English or raw SQL. History tab lists saved/recent/team prompts. Schema tab lists approved tables and project_id binding.',
      },
    },
    '/research': {
      title: 'Research',
      description:
        'Status banner first — Summary for posture, Search to look things up, History for past sessions.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        sessions: 'Sessions',
        snippets: 'Snippets',
        attached: 'Attached',
        unattached: 'Unattached',
        firecrawl: 'Firecrawl',
        domains: 'Domains',
      },
      actionLabels: {
        setup: 'Go to Setup',
        configure: 'Configure Firecrawl',
        fix: 'Fix in Settings',
        test: 'Test connection',
        search: 'Run first search',
        attach: 'Attach evidence',
        history: 'View history',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        search: 'Search',
        history: 'History',
      },
      help: {
        title: 'About web research',
        whatIsIt: 'Search the web while reviewing a bug — look up release notes, Stack Overflow threads, or vendor changelogs and pin the result to a specific report.',
        useCases: [
          'Cross-reference an error signature against current upstream docs',
          'Find a Stack Overflow thread to attach as review evidence',
          'Check if a third-party library shipped a fix in the last 24 hours',
        ],
        howToUse: 'Add your Firecrawl key in Settings, then search on the Search tab. Paste a report UUID on any snippet and click Attach evidence. Sessions persist per project — reopen them from History.',
      },
    },
    '/repo': {
      title: 'Pull requests',
      description:
        'Banner + REPO SNAPSHOT first — Summary for connection health, Branches for PR status, Activity for the live event log.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        branches: 'Branches',
        prOpen: 'PRs open',
        ciPassing: 'CI passing',
        ciFailed: 'CI failing',
        merged: 'Merged',
        stuck: 'Stuck',
      },
      actionLabels: {
        setup: 'Go to Setup',
        connect: 'Connect repo',
        install: 'Install app',
        stuck: 'Review stuck',
        ci: 'Open failing CI',
        reports: 'Open Reports',
        branches: 'View branches',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        branches: 'Branches',
        activity: 'Activity',
      },
      help: {
        title: 'About pull requests',
        whatIsIt: 'Link your GitHub repo here once, and every auto-fix Mushi drafts will appear as a pull request in the right branch.',
        useCases: [
          'Connect your repo so the auto-fix agent has somewhere to open PRs',
          'Check connection health if PRs stopped appearing',
          'Switch to a different repo or branch',
        ],
        howToUse:
          'Summary shows repo connection health. Branches lists every fix PR with CI status. Activity is a chronological log across all branches.',
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
      description: 'Append-only record of who changed what — human, agent, and system actions with CSV export.',
      help: {
        title: 'About the audit log',
        whatIsIt: 'Tamper-proof record of every consequential action: report reviews, key rotation, settings saves, fix dispatch, and compliance events.',
        useCases: [
          'Answer "who changed this setting" or "when was this key revoked"',
          'Filter failures (fix.failed) before a SOC 2 review',
          'Export the current filter view as CSV evidence',
        ],
        howToUse: 'Overview shows posture + hero. Log tab stacks filters and expands metadata JSON. Breakdown tab surfaces 24h actor mix and top 7-day actions.',
      },
    },
    '/prompt-lab': {
      title: 'AI prompts',
      description: 'Edit the instructions that tell the AI how to classify bugs and draft fixes. Improve accuracy without any code changes.',
      help: {
        title: 'About AI prompts',
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
      title: 'Weekly insights',
      description:
        'A plain-English summary of each week: bugs in, fixes out, and what changed.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        digests: 'Digests',
        activeJobs: 'Active jobs',
        failedJobs: 'Failed jobs',
        findings: 'Findings',
        fixAttempts: 'Fix attempts',
        benchmarking: 'Benchmarking',
      },
      actionLabels: {
        setup: 'Go to Setup',
        upgrade: 'Upgrade plan',
        pipeline: 'View jobs',
        generate: 'Generate this week',
        retry: 'Retry generation',
        settings: 'Check LLM keys',
        triage: 'Review findings',
        reports: 'View reports',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        reports: 'Reports',
        pipeline: 'Jobs',
      },
      help: {
        title: 'About Bug Intelligence',
        whatIsIt: 'Weekly AI-written digest of your bug trends — fix velocity, hotspots, and recommendations. Each report is persisted, versioned, and exportable as HTML/PDF.',
        useCases: [
          'Share a one-page status with stakeholders every Monday',
          'Spot regressions early — week-over-week category and severity drift',
          'Compare fix velocity against anonymised industry benchmarks (opt-in)',
        ],
        howToUse: 'Reports generate automatically every Monday by cron. Click Generate to run for the current project — Jobs shows live status and errors for debugging.',
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
      title: 'Plugins',
      description:
        'Banner + MARKETPLACE SNAPSHOT first — Summary for posture, Browse to install, Deliveries to debug webhooks.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        catalog: 'Catalog',
        installed: 'Installed',
        deliveries7d: 'Deliveries · 7d',
        successRate: 'Success rate',
        failing: 'Failing',
        neverDelivered: 'Never delivered',
      },
      actionLabels: {
        browse: 'Browse catalog',
        installed: 'Open Installed',
        deliveries: 'View deliveries',
        resume: 'Resume plugins',
        refresh: 'Refresh',
        plans: 'View plans',
      },
      tabLabels: {
        overview: 'Summary',
        browse: 'Browse',
        installed: 'Installed',
        deliveries: 'Deliveries',
      },
      help: {
        title: 'About plugins',
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
      title: 'Editor agents',
      description:
        'Banner + MCP SNAPSHOT first — Summary for posture, Setup for snippet, Catalog for tools and resources.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        activeKeys: 'Active keys',
        mcpRead: 'MCP read',
        connected: 'Connected',
        sdkOnly: 'SDK-only keys',
        tools: 'Tools',
        endpoint: 'Endpoint',
      },
      actionLabels: {
        setup: 'Fix snippet',
        mint: 'Mint MCP key',
        generate: 'Generate key',
        catalog: 'View catalog',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        setup: 'Setup',
        catalog: 'Catalog',
        examples: 'Examples',
      },
      help: {
        title: 'About editor agents',
        whatIsIt: 'MCP lets your coding assistant call Mushi tools during a chat — read reports, dispatch fixes, and query production data without copy-pasting IDs.',
        useCases: [
          'Ask Cursor "what should I fix next?" and get an answer from your real bugs',
          'Have the agent draft a fix for a specific report in one command',
          'Query your bug data in plain English from inside your editor',
        ],
        howToUse:
          'Generate an mcp:read key on /projects, copy the snippet on Setup, restart your IDE, then ask "list mushi tools".',
      },
    },
    '/qa-coverage': {
      title: 'Scheduled tests',
      description:
        'Banner + QA SNAPSHOT first — Summary for posture, Stories for all tests, Failing for sub-80% pass rate.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        stories: 'Stories',
        passing: 'Passing',
        failing: 'Failing',
        avgPassRate: 'Avg pass rate',
        runs24h: 'Runs (24h)',
        noData: 'No data',
      },
      actionLabels: {
        setup: 'Go to Setup',
        create: 'Create story',
        newStory: '+ New story',
        failures: 'Review failures',
        stories: 'View stories',
        openStories: 'Open stories',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        stories: 'Stories',
        failing: 'Failing',
      },
      help: {
        title: 'About scheduled tests',
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
      title: 'Spam & abuse',
      description: 'Detect and block fake or spammy bug reports so your inbox stays clean and your credits aren\'t wasted.',
      help: {
        title: 'About spam & abuse',
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
      title: 'Tester rewards',
      description: 'Banner + REWARDS SNAPSHOT — Overview for 24h feed, Rules/Tiers to configure, Settings for webhooks and disputes.',
      help: {
        title: 'About tester rewards',
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
      title: 'Lessons',
      description:
        'Bugs that keep coming back, how many reports each has, and the rule Mushi suggests for it.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        activeLessons: 'Rules in use',
        critical: 'Critical',
        candidates: 'Ready to promote',
        promoted: 'Patterns made rules',
        reportsClustered: 'Reports grouped',
        highCoherence: 'Strong patterns',
      },
      actionLabels: {
        setup: 'Go to Setup',
        reports: 'Open Reports',
        clusters: 'Review recurring patterns',
        lessons: 'Review rules in use',
        query: 'Try a change',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        lessons: 'Rules in use',
        clusters: 'Recurring patterns',
        query: 'Try a change',
      },
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
      description:
        'Banner + RELEASES SNAPSHOT first — Summary for posture, Drafts/Published to manage, Draft to generate with AI.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        drafts: 'Drafts',
        published: 'Published',
        fixesLinked: 'Fixes linked',
        contributors: 'Contributors',
        fixedReports: 'Fixed bugs',
        feedback: 'Feedback shipped',
      },
      actionLabels: {
        setup: 'Go to Setup',
        drafts: 'Review drafts',
        draft: 'Generate draft',
        published: 'View published',
        reports: 'View fixed reports',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        drafts: 'Drafts',
        published: 'Published',
        draft: 'New draft',
      },
      help: {
        title: 'About Releases',
        whatIsIt: 'Release drafts scan fixed bug reports from a time window, attribute them to reporters, and write a plain-English changelog using AI.',
        useCases: [
          'Auto-generate changelogs linked to the users who reported each fix',
          'Notify credited reporters in the feedback stamp when you publish',
          'Close the feedback loop: users see what their reports fixed',
        ],
        howToUse:
          'Summary for posture. Drafts to review pending changelogs. Published for shipped releases. New draft to generate from fixed bugs.',
      },
    },
    '/iterate': {
      title: 'Improvement runs',
      description:
        'Status banner first — Summary for the big picture, Runs to watch progress, New Run to start a loop.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        total: 'Total runs',
        active: 'Active',
        succeeded: 'Succeeded',
        failed: 'Failed',
        avgScore: 'Avg score',
        iterations: 'Iterations',
      },
      actionLabels: {
        setup: 'Go to Setup',
        runs: 'View runs',
        openRuns: 'Open runs',
        newRun: 'New run',
        queue: 'Queue new run',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        runs: 'Runs',
        new: 'New Run',
      },
      help: {
        title: 'About improvement runs',
        whatIsIt: 'Each run fetches a live page, generates improved markup, then scores it with an AI critic. The loop repeats until the target score or max iterations.',
        useCases: [
          'Improve a dashboard page\'s visual hierarchy automatically',
          'Run a WCAG accessibility critique cycle on a live URL',
          'Use a conversion persona to suggest CTA and copy improvements',
        ],
        howToUse: 'Overview shows current posture. Queue on New Run, trigger queued rows on Runs, open a run for score timeline and critique export.',
      },
    },
    '/drift': {
      title: 'Schema changes',
      description:
        'Whether your API routes or database tables changed since the last scan, and which change can break a caller.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        openFindings: 'Changes to review',
        critical: 'Serious',
        warnings: 'Warnings',
        snapshots: 'Scans',
        contractEdges: 'Routes and tables tracked',
        surfaces: 'Surfaces',
      },
      actionLabels: {
        setup: 'Go to Setup',
        findings: 'Review findings',
        review: 'Review findings',
        scan: 'Run scan',
        firstScan: 'Run first scan',
        snapshots: 'View snapshots',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        findings: 'Changes',
        snapshots: 'Scans',
        scanner: 'Run a scan',
      },
      help: {
        title: 'About schema changes',
        whatIsIt: 'Each scan reads your API routes, your app map and your database tables, and compares them with the scan before. A change that can break a caller (a removed route, a dropped column) is marked serious.',
        useCases: [
          'Find an API route your app calls that no longer exists',
          'Catch a database column the frontend reads that was dropped',
          'Turn a serious change into a lesson so it is not repeated',
        ],
        howToUse: 'Run a scan from the Run a scan tab, then review the changes. Dismiss the ones that are fine; Mushi checks those routes less often.',
      },
    },
    '/experiments': {
      title: 'Experiments',
      description:
        'Banner + EXPERIMENTS SNAPSHOT first — Summary for posture, Experiments to launch/monitor, New to create variants.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        total: 'Total',
        running: 'Running',
        readyToLaunch: 'Ready to launch',
        winners: 'Winners',
        assignments: 'Assignments',
        conversion: 'Conversion',
      },
      actionLabels: {
        setup: 'Go to Setup',
        monitor: 'Monitor runs',
        drafts: 'Review drafts',
        create: 'Create experiment',
        winners: 'Review winners',
        finish: 'Finish setup',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        experiments: 'Experiments',
        new: 'New',
      },
      help: {
        title: 'About experiments',
        whatIsIt: 'Compare two or more versions of a screen and see which one more users finish. Mushi splits your users through the SDK and tells you when one version is clearly ahead.',
        useCases: [
          'Test button copy, colour, or layout variants',
          'Measure impact of a new feature on conversion rate',
          'Send more users to the winning version while the test runs, when you have few users',
        ],
        howToUse: 'Create an experiment, add versions, start it. The SDK assigns users via mushi.experiment(). Check the result at any time: looking early does not fake a winner.',
      },
    },
    '/anomalies': {
      title: 'Unusual spikes',
      description:
        'Metrics that jumped far outside their normal range, and whether the jump started with a release.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        open: 'Spikes to review',
        releaseRegressions: 'After a release',
        highScore: 'High score',
        autoReported: 'Auto-reported',
        metricPoints: 'Metrics watched',
        dismissed: 'Dismissed',
      },
      actionLabels: {
        setup: 'Go to Setup',
        triage: 'Review anomalies',
        review: 'Review anomalies',
        ingest: 'Add metrics',
        detect: 'Run detection',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        anomalies: 'Spikes',
        metrics: 'Metrics',
      },
      help: {
        title: 'About unusual spikes',
        whatIsIt: 'Send any number your app tracks (error rate, latency, sign-ups). Mushi checks them every hour, draws each one with your releases on it, and opens a bug report when a spike starts right after a release.',
        useCases: [
          'See a crash-rate jump that started with a release',
          'Notice latency creeping up after a deploy',
          'Get a bug report opened for a confirmed regression',
        ],
        howToUse: 'Send some values from the Metrics tab, then press Check now on the Spikes tab or wait for the hourly check. Confirm a real spike or dismiss noise under its chart.',
      },
    },
    '/cost': {
      title: 'What AI calls cost',
      description:
        'Status banner first — Summary for trend, Breakdown by model, Raw log to inspect individual calls.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        total: 'Total logged',
        day24h: 'Last 24 hours',
        month: 'This month',
        topDriver: 'Top driver',
        operations: 'Operations',
        models: 'Models',
        keySource: 'Key source · 24h',
      },
      actionLabels: {
        health: 'Run health test',
        log: 'Inspect log',
        failures: 'View failures',
        byok: 'Add your LLM keys',
        breakdown: 'View breakdown',
      },
      tabLabels: {
        overview: 'Summary',
        breakdown: 'Breakdown',
        log: 'Raw log',
      },
      help: {
        title: 'About AI cost tracking',
        whatIsIt: 'Every AI step writes token counts and cost. This page rolls spend up by operation, model, and day.',
        useCases: [
          'See which classify/fix/judge step costs the most before tuning prompts',
          'Spot a runaway cron from the 24h spend banner or daily chart',
          'Confirm your own keys vs platform key usage before your billing cycle',
        ],
        howToUse:
          'Summary shows health + trend. Breakdown groups by operation/model. Raw log searches individual calls. Add your Anthropic key in Settings → LLM keys to bill your own account.',
      },
    },
    '/notifications': {
      title: 'Reporter updates',
      description:
        'Whether the people who report bugs hear back when their bug is diagnosed, fixed and shipped, and whether they opened it.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        total: 'Total',
        unread: 'Unread',
        last24h: 'Last 24h',
        enabled: 'Enabled',
        fixFailed: 'Fix failed',
        lastMessage: 'Last message',
      },
      actionLabels: {
        settings: 'Open Settings',
        inbox: 'Review inbox',
        setup: 'Open Setup',
        viewInbox: 'View inbox',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        inbox: 'Sent',
        setup: 'Setup',
      },
      help: {
        title: 'About reporter updates',
        whatIsIt: 'Messages queued for end users who submitted bugs. The SDK polls this inbox so reporters see when their report was classified, fixed, or rewarded.',
        useCases: [
          'Verify the reporter widget is receiving classify/fix updates',
          'Audit which reporter tokens were notified for a given report',
          'Debug stale unread rows when client polling stops',
        ],
        howToUse: 'Filter by type or unread, expand payloads to inspect JSON, mark read when verified. Reporter updates must be on (Setup tab).',
      },
    },
    '/billing': {
      title: 'Your plan & usage',
      description:
        'Banner + BILLING SNAPSHOT first — Summary for usage + invoices, Plans to compare tiers, Support for billing tickets.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        plan: 'Plan',
        reports: 'Reports · period',
        fixes: 'Fixes · period',
        llmCogs: 'LLM COGS · month',
      },
      actionLabels: {
        upgrade: 'Upgrade plan',
        manage: 'Manage in Stripe',
        plans: 'Compare plans',
        payment: 'Update payment',
        projects: 'Create project',
        cost: 'See AI spend',
        health: 'Run Health test',
      },
      tabLabels: {
        overview: 'Summary',
        plans: 'Plans',
        support: 'Support',
      },
      help: {
        title: 'About billing',
        whatIsIt: 'Per-project subscription and usage meters. Hobby includes a monthly report quota; paid plans add higher limits, your own LLM keys, and Stripe-managed billing.',
        useCases: [
          'See reports used vs quota before new reports start returning HTTP 402',
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
      title: 'Code map',
      description:
        'Banner + EXPLORE SNAPSHOT first — Summary for posture, Understand (Ask/Tour/Domains/Knowledge), Map (Graph/Layers), Search, Index for debug.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        files: 'Files',
        uiLayer: 'UI layer',
        backend: 'Backend',
        embedded: 'Embedded',
      },
      actionLabels: {
        setup: 'Go to Setup',
        index: 'Open Index tab',
        debug: 'Debug index',
        settings: 'Open Settings',
        graph: 'Open Graph',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        understand: 'Understand',
        map: 'Map',
        ask: 'Ask',
        tour: 'Tour',
        domains: 'Domains',
        knowledge: 'Knowledge',
        graph: 'Graph',
        layers: 'Layers',
        search: 'Search',
        index: 'Index',
      },
      help: {
        title: 'About Code map',
        whatIsIt: 'A visual map of your code that shows every file, how files connect, and lets you search and chat with plain English.',
        useCases: [
          'Understand → Ask: "How does auth work?" with file:line citations',
          'Understand → Tour: onboarding walkthrough that highlights the map',
          'Map → Graph: canvas coloured by UI / Backend / Test layer',
          'Search: semantic lookup once embeddings are populated',
        ],
        howToUse:
          'Summary for posture. Understand (Ask / Tour / Domains) to learn the repo. Map (Graph / Layers) for structure. Search for plain-English lookup. Index when debugging sweeper errors.',
      },
    },
    '/connect': {
      title: 'Connect',
      description: 'One hub to connect GitHub, install the SDK + MCP, and open upgrade PRs.',
      help: {
        title: 'About Connect',
        whatIsIt: 'The install and upgrade hub — connect your repo, copy SDK and editor install commands, and open a PR that bumps @mushi-mushi packages.',
        useCases: [
          'First-time setup: connect GitHub → install SDK → add MCP to Cursor',
          'Upgrade path: "Create Upgrade PR" bumps @mushi-mushi/* to latest npm',
          'Verify indexing: enable codebase index so Explore can map your repo',
        ],
        howToUse: 'Connect GitHub first. Copy the SDK install snippet into your app, then use MCP deeplinks for Cursor. When versions drift, click Create Upgrade PR and merge after CI passes.',
      },
    },
    '/code-health': {
      title: 'Code size',
      description: 'Bundle-size trends and oversized-file warnings from your app\'s CI.',
      help: {
        title: 'About code health',
        whatIsIt: 'CI-sent bundle budgets and oversized-file warnings for the connected app.',
        useCases: ['Spot bundle regressions after a release', 'Find files that need splitting before they become unmaintainable'],
        howToUse: 'Send metrics from your repo CI; open this page to see the latest numbers and gate findings.',
      },
    },
    '/content': {
      title: 'Content checks',
      description: 'Review AI-generated or imported content before it ships to learners.',
      help: {
        title: 'About content checks',
        whatIsIt: 'A review queue for generated copy, thumbnails, and lesson content awaiting approval.',
        useCases: ['Approve safe content before publish', 'Reject off-brand or incorrect generated text'],
        howToUse: 'Filter by status, open a row, approve or reject with a note.',
      },
    },
    '/feature-board': {
      title: 'Feature requests',
      description: 'Community feature requests ranked by votes and impact.',
      help: {
        title: 'About feature requests',
        whatIsIt: 'End-user feature ideas linked to your project, with vote counts and status.',
        useCases: ['See what users ask for most', 'Promote a request into your roadmap'],
        howToUse: 'Sort by votes or recency; link items to reports or inventory stories when you start work.',
      },
    },
    '/fullstack-audit': {
      title: 'Full-stack audit',
      description: 'One-click health scorecard — schema, API contracts, access rules, and backend logs.',
      help: {
        title: 'About full-stack audit',
        whatIsIt: 'Runs health checks and backend probes to surface contract drift, missing access rules, and error spikes.',
        useCases: ['Pre-release sanity check', 'Onboard a new repo with a baseline scorecard'],
        howToUse: 'Configure Supabase PAT + project ref in Settings, then run audit and review findings by severity.',
      },
    },
    '/skills': {
      title: 'Agent skills',
      description: 'Browse editor playbooks, sync sources, and track runs attached to reports.',
      help: {
        title: 'About agent skills',
        whatIsIt: 'Catalog of fix playbooks your editor can read, plus live runs when you attach one to a report.',
        useCases: ['Find the right skill for a bug class', 'Watch a cloud run step complete'],
        howToUse: 'Catalog tab to browse; Runs tab for active jobs; Sources tab to sync GitHub repos.',
      },
    },
    '/tester': {
      title: 'Tester hub',
      description: 'External tester onboarding and reward flows.',
      help: {
        title: 'About the tester hub',
        whatIsIt: 'Manage community testers who submit bugs through the widget.',
        useCases: ['Invite testers', 'Track rewards and leaderboard standing'],
        howToUse: 'Share invite links from Rewards; monitor submissions on Reports.',
      },
    },
    '/users': {
      title: 'All users',
      description: 'Operator-only view of all signups, plans, and activity. Useful for support and growth tracking.',
      help: {
        title: 'About all users',
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
      title: 'Home',
      description: 'How your app is doing right now: health, what needs you, the next release, and your busiest pages.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        backlog: 'Backlog',
        reports: 'Reports 14d',
        fixes: 'Fixes',
        focus: 'Focus',
      },
      actionLabels: {
        setup: 'Continue setup',
        triage: 'Review bugs',
        failed: 'See why it stopped',
        health: 'View health',
        verify: 'Send test report',
        healthy: 'View loop',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Overview',
        loop: 'Loop',
        metrics: 'Metrics',
        health: 'Health',
      },
      help: {
        title: 'About your home screen',
        whatIsIt:
          'One page per app: is it up, erroring or slow; what needs you; what is shipping and what is waiting; which pages have bugs; and who can reach it.',
        useCases: [
          'Check the four lights: site up, errors today, SDK sending, CI on main',
          'Clear the few things that need you, most costly first',
          'See how far fixes have got toward a release, and how many bugs wait by severity',
          'Compare this week with last week',
        ],
        howToUse:
          'Every number opens the list it counts. A grey light is not connected yet; its button says how to connect it. "How this works" at the bottom explains what Mushi does with a bug.',
      },
    },
    '/reports': {
      title: 'Bugs',
      description:
        'Status banner first — then Overview for the big picture, Queue to review bugs, Severity for 14-day trends.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        total14d: 'Last 14 days',
        untriaged: 'Needs review',
        critical: 'Critical',
        dismissed: 'Dismissed',
      },
      actionLabels: {
        setup: 'Go to Setup',
        verify: 'Send test report',
        triage: 'Review critical',
        backlog: 'Open backlog',
        queue: 'Open queue',
        severity: 'Severity view',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Overview',
        queue: 'Queue',
        severity: 'Severity',
      },
      help: {
        title: 'About bugs',
        whatIsIt:
          'A list of bugs your end-users flagged, automatically grouped, scored, and ranked by how many people are affected.',
        useCases: [
          'Read the status banner — red = critical bugs waiting, green = queue current',
          'Queue tab: navigate with j/k, bulk dismiss, send to auto-fix',
          'Severity tab: 14-day sparklines — click a tile to filter the queue',
        ],
        howToUse:
          'Overview for posture + top priority. Queue for the sortable table. Severity for trends. Refresh reloads stats + list.',
      },
    },
    '/graph': {
      title: 'Bug clusters',
      description: 'See where bugs cluster — red banner means a hotspot needs attention.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        nodes: 'Spots',
        edges: 'Links',
        fragile: 'Hotspots',
        inventory: 'Screens',
      },
      actionLabels: {
        setup: 'Go to Setup',
        verify: 'Send test bug',
        reports: 'Open bugs',
        explore: 'Open map',
        regressions: 'See regressions',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        explore: 'Map',
        backend: 'Sync debug',
      },
      help: {
        title: 'About bug clusters',
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
      title: 'Fixes',
      description:
        'Status banner first — Summary for posture, In flight for active dispatches, Attempts for draft PRs.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        totalAttempts: 'Fixes (30 days)',
        completed: 'Fixed',
        failed: 'Failed',
        inProgress: 'In flight',
        prsOpen: 'PRs open',
        prsCiPassing: 'CI passing',
      },
      actionLabels: {
        setup: 'Go to Setup',
        github: 'Connect repo',
        index: 'Enable indexing',
        failed: 'Review failed',
        pipeline: 'View in flight',
        reports: 'Open Reports',
        attempts: 'View attempts',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Summary',
        pipeline: 'In flight',
        attempts: 'Attempts',
      },
      help: {
        title: 'About fix drafts',
        whatIsIt:
          'When you send a bug to auto-fix, Mushi opens a draft pull request on your repo. Each one comes with a one-paragraph rationale and a screenshot diff.',
        useCases: [
          'Review draft PRs before they land — like a junior engineer\u2019s first attempt',
          'See quality scores so you know which fixes are confidence-worthy',
          'Re-run the agent with a different prompt if the first attempt missed',
        ],
        howToUse:
          'Summary for posture. In flight shows dispatches still running. Attempts lists every draft PR — expand a card for rationale and CI status.',
      },
    },
    '/judge': {
      title: 'Triage grading',
      description:
        'Whether you can trust Mushi’s diagnoses: how often a second AI agrees with them, and the worst recent disagreements.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        week: 'This week',
        total: 'Total graded',
        disagree: 'Disagreements',
        drift: 'Week change',
        classified: 'Ready to grade',
        prompts: 'Prompt versions',
      },
      actionLabels: {
        setup: 'Go to Setup',
        run: 'Run judge now',
        reports: 'Open Reports',
        investigate: 'Investigate',
        disagreements: 'See disagreements',
        trend: 'View trend',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Overview',
        trend: 'Trend',
        evaluations: 'Grades',
        prompts: 'Prompts',
      },
      help: {
        title: 'About triage grading',
        whatIsIt:
          "A second AI grades each diagnosis Mushi makes: was the category right, the severity, the part of the app, and were the steps to reproduce usable. The chart shows how often it agrees, week by week, so you can tell whether to trust a diagnosis before you merge its fix.",
        useCases: [
          'See whether the diagnoses are getting better or worse week by week',
          'Read the worst recent disagreements before merging their fixes',
          'Find the AI prompts that keep scoring low so they can be rewritten',
        ],
        howToUse:
          'Click any prompt row in the leaderboard to filter Recent evaluations to just that version. Click any low-score row to inspect the original report and the judge\u2019s reasoning.',
      },
    },
    '/health': {
      title: 'Mushi health',
      description:
        'Whether Mushi itself is working: the AI calls behind your diagnoses and fixes, and its background jobs.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        calls: 'AI calls',
        errors: 'Error rate',
        fallbacks: 'Fallback rate',
        latency: 'Speed avg / p95',
        cron: 'Jobs OK',
        lastCall: 'Last call',
      },
      actionLabels: {
        setup: 'Go to Setup',
        verify: 'Send test report',
        llm: 'Inspect LLM',
        cron: 'Open cron',
        activity: 'View activity',
        refresh: 'Refresh',
      },
      tabLabels: {
        overview: 'Overview',
        llm: 'AI calls',
        cron: 'Scheduled jobs',
        activity: 'Recent traces',
      },
      help: {
        title: 'About Mushi health',
        whatIsIt:
          'Real-time vitals for every LLM call Mushi makes — how fast it responds, how often it fails, and how much each call costs you.',
        useCases: [
          'Catch a slow-down before users notice (average / p95 latency trend)',
          'Spot a model outage early (error rate spike)',
          'Watch your daily LLM spend so you don\u2019t blow your budget',
        ],
        howToUse:
          'Switch the time window to compare. Click "Run now" on a cron job to fire it manually. Click any LLM call to open its full trace in Langfuse.',
      },
    },
    '/integrations': {
      title: 'Integrations',
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
          'Give the AI Sentry context when classifying user reports',
          'Let auto-fix open draft PRs on your GitHub repo',
          'Forward critical bugs to Jira, Linear, or PagerDuty',
        ],
        howToUse:
          'Use the Platform tab to paste keys and Test each card. Routing tab connects ticketing tools. Repo & index covers codebase indexing for auto-fix.',
      },
    },
    '/integrations/config': {
      title: 'Integrations',
      description:
        'Status banner first — Platform for Sentry/Langfuse/GitHub, Routing for ticketing, Repo & index for auto-fix grounding.',
      sections: { snapshot: 'At a glance', workspace: 'Integration workspace' },
      statLabels: {
        platform: 'Platform',
        healthy: 'Healthy probes',
        routing: 'Routing',
        failing: 'Failing',
      },
      actionLabels: {
        platform: 'Finish platform',
        health: 'Open health',
        repo: 'Check repo index',
        routing: 'Add routing',
      },
      tabLabels: {
        platform: 'Platform',
        routing: 'Routing',
        repo: 'Repo & index',
      },
      help: {
        title: 'About integrations',
        whatIsIt:
          'Mushi uses your existing observability and code tools. Platform cards feed the AI steps; routing forwards reviewed reports; Repo & index grounds auto-fix in your codebase.',
        useCases: [
          'Give the AI Sentry context when classifying user reports',
          'Let auto-fix open draft PRs on your GitHub repo',
          'Forward critical bugs to Jira, Linear, or PagerDuty',
        ],
        howToUse:
          'Platform tab: Edit credentials → Test. Routing tab: connect ticketing tools. Repo & index: enable codebase indexing before dispatching fixes.',
      },
    },
    '/settings': {
      title: 'Settings',
      description:
        'The banner says what to do first. General sets alerts and bug sorting, AI keys holds your own keys, SDK & connection installs the widget and sends a test bug.',
      sections: { snapshot: 'Summary' },
      statLabels: {
        byok: 'API keys',
        sdk: 'Reporter widget',
        routing: 'Routing hooks',
        classifier: 'Classifier',
      },
      actionLabels: {
        byok: 'Fix keys',
        sdk: 'Open SDK & connection',
        test: 'Test keys',
        integrations: 'Integrations',
        pipeline: 'Send a test bug',
      },
      help: {
        title: 'About settings',
        whatIsIt:
          'Settings for the active app: where bug alerts go, your own AI keys (optional), how bugs are sorted and grouped, the feedback widget, and developer options.',
        useCases: [
          'Bring your own Anthropic / OpenAI keys so cost stays on your bill',
          'Run SDK & connection → Send a test bug before wiring production SDK traffic',
          'Tune the classifier model and dedup threshold after false positives in review',
        ],
        howToUse:
          'Each tab is a list. Every row says what it does, whether it works, and the one thing to do next. Changes apply when you press Save.',
      },
    },
    '/onboarding': {
      title: 'Set up',
      description: 'Three short steps: create a project, install the widget, send a test bug to see it work.',
      sections: { snapshot: 'Setup snapshot' },
      statLabels: {
        required: 'Required steps',
        sdk: 'SDK status',
        reports: 'Reports',
        optional: 'Optional',
      },
      // No tabLabels: the page's own plain names apply ("More to connect", "Test it",
      // "Install"); "Steps / Verify / SDK" here overrode them (2026-10-28).
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
      title: 'To-do',
      description: 'Everything that needs a decision from you, across bugs, fixes, checks and releases, oldest first.',
    },
    '/feedback': {
      title: 'Help & support',
      description: 'Support tickets and feature requests from your users, and what shipped for them.',
    },
    '/projects': {
      title: 'Manage apps',
      description: 'Multi-tenant project registry — API keys, SDK heartbeat, per-project deep links.',
    },
    '/queue': {
      title: 'Processing jobs',
      description: 'DLQ + stuck pipeline items. Retry, inspect failure stage, flush backlog.',
    },
    '/inventory': {
      title: 'User stories',
      description: 'Your app’s user stories and actions, and whether each one is verified, stubbed or broken.',
    },
    '/query': {
      title: 'SQL query',
      description: 'NL + raw SQL analytics — saved history, team pins, 24h error/latency stats.',
    },
    '/research': {
      title: 'Research',
      description: 'Search the web for evidence about a bug and pin what you find to its report.',
    },
    '/repo': {
      title: 'Pull requests',
      description: 'GitHub OAuth, default branch, fix-worker target repo health.',
    },
    '/sso': {
      title: 'Single sign-on',
      description: 'SAML GoTrue registration, domain routing, and provider health per project.',
    },
    '/audit': {
      title: 'Audit log',
      description: 'Append-only mutation trail — human + agent actors, filter stack, CSV export.',
    },
    '/prompt-lab': {
      title: 'AI prompts',
      description: 'Versioned classifier/fix prompts with shadow tests on live reports.',
    },
    '/intelligence': {
      title: 'Weekly insights',
      description: 'Weekly digests of what changed in your bug and fix numbers, and why.',
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
      title: 'Plugins',
      description: 'Webhook plugin catalog, installs, and signed delivery log per project.',
    },
    '/mcp': {
      title: 'Editor agents',
      description: 'Connect your editor’s agent to this app and check that it is talking to Mushi.',
    },
    '/qa-coverage': {
      title: 'Scheduled tests',
      description: 'User-flow tests that run on a schedule, and which of them are failing.',
    },
    '/anti-gaming': {
      title: 'Spam & abuse',
      description: 'Heuristics for synthetic / duplicate / low-signal report abuse.',
    },
    '/rewards': {
      title: 'Tester rewards',
      description: 'Points and tiers for the testers who report bugs, and the webhooks that grant them.',
    },
    '/lessons': {
      title: 'Lessons',
      description: 'Rules learned from repeated bugs that every new fix follows.',
    },
    '/releases': {
      title: 'Releases',
      description: 'Changelogs that tell each reporter their bug shipped.',
    },
    '/iterate': {
      title: 'Improvement runs',
      description: 'One AI drafts a change to a page of your app and a second AI critiques it until it passes.',
    },
    '/drift': {
      title: 'Schema changes',
      description: 'Whether your API routes or database tables changed since the last scan.',
    },
    '/experiments': {
      title: 'Experiments',
      description: 'A/B tests of a change, and which variant won.',
    },
    '/anomalies': {
      title: 'Unusual spikes',
      description: 'Metrics that jumped outside their normal range, drawn with your releases.',
    },
    '/cost': {
      title: 'AI spend',
      description: 'What the AI behind diagnoses and fixes costs, by step and by day.',
    },
    '/notifications': {
      title: 'Reporter updates',
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
      title: 'Code map',
      description: 'Ask about your codebase, map it, and see where a bug lives in the code.',
    },
    '/connect': {
      title: 'Connect',
      description: 'GitHub connect, SDK install, MCP deeplinks, and one-click upgrade PRs.',
    },
    '/users': {
      title: 'All users',
      description: 'Operator directory — signups, plans, last-seen activity.',
    },
    '/dashboard': {
      title: 'Home',
      description: 'Your app at a glance: health, what needs you, the release, pages and access.',
    },
    '/reports': {
      title: 'Bugs',
      description: 'Every bug your users and monitors sent, with its diagnosis and a fix to start.',
    },
    '/graph': {
      title: 'Bug clusters',
      description: 'Which bugs share a cause, grouped by the page or component they hit.',
    },
    '/fixes': {
      title: 'Fixes',
      description: 'Draft PRs from the agent. Judge score + screenshot-diff per attempt.',
    },
    '/judge': {
      title: 'Triage grading',
      description: 'How well the AI triages bugs (severity, category, diagnosis), graded over time.',
    },
    '/health': {
      title: 'Mushi health',
      description: 'Whether Mushi itself is working: its AI calls and background jobs. Your app’s uptime and errors are on Home.',
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
      description: 'Alerts, AI keys, web tools, voice reports, and the SDK connection.',
    },
    '/onboarding': {
      title: 'Set up',
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
 *
 * `draftedFixes` and `mergedFixes` are for `component` only: open or draft
 * PRs still waiting, and merged PRs. They are not a project-wide attempt
 * total, and the drafted count is not `total - merged` (that remainder
 * tracked the inbox's report count).
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
      draftedFixes > 0
        ? ` and ${draftedFixes} more drafted.`
        : '.'
    return `${headline} ${merged}${drafted}`
  }
  if (draftedFixes > 0) {
    const drafted = draftedFixes === 1 ? '1 fix drafted' : `${draftedFixes} fixes drafted`
    return `${headline} ${drafted} — ready for your review.`
  }
  return `${headline} No fixes drafted yet — open one and let Mushi try.`
}
