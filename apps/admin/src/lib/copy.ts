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
    '/inbox': {
      title: 'Your to-do list',
      description: 'One place to see everything that needs your attention right now — across every stage of the bug-fix loop.',
      help: {
        title: 'About the inbox',
        whatIsIt: 'A single dashboard that shows every action waiting for you — bugs to triage, fixes to review, and connections to set up.',
        useCases: [
          'Start every morning here — see what actually needs your attention today',
          'Jump to the highest-priority bug in one click',
          'Quickly check if everything is on track or if something is stuck',
        ],
        howToUse: 'Click any open action card to jump straight to that page. Stages with a green check are all clear — no action needed.',
      },
    },
    '/projects': {
      title: 'Your projects',
      description: 'Create and manage projects — one per app or environment. Each project gets its own bug inbox, API key, and settings.',
      help: {
        title: 'About projects',
        whatIsIt: 'A project is a container for one app or environment. Everything in Mushi — bugs, fixes, reports — belongs to a project.',
        useCases: [
          'Create a project for your main app (takes 30 seconds)',
          'Add a separate project for staging so test bugs don\'t mix with real ones',
          'Generate an API key here to paste into your app code',
        ],
        howToUse: 'Click "New project" to create one. Click any existing project card to see its API keys, settings, and health.',
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
      description: 'A map of every screen and user flow in your app, with bug counts attached. Know where the pain lives.',
      help: {
        title: 'About app inventory',
        whatIsIt: 'An automatically built map of your app\'s pages and features, with live bug counts so you can see which parts are healthiest.',
        useCases: [
          'Find which screen has the most unfixed bugs right now',
          'Check that a new feature was picked up and is being monitored',
          'See coverage gaps — flows Mushi hasn\'t seen a report from yet',
        ],
        howToUse: 'Browse by screen or user flow. Click any item to see all bug reports linked to it.',
      },
    },
    '/query': {
      title: 'Ask your data',
      description: 'Type a question in plain English and get a live answer from your project\'s bug data. No SQL needed.',
      help: {
        title: 'About data queries',
        whatIsIt: 'Ask questions like "How many critical bugs landed this week?" and get instant answers straight from your project\'s database.',
        useCases: [
          'Answer a manager\'s question without exporting a spreadsheet',
          'Check trends ("Are bugs up or down this sprint?")',
          'Find specific reports without clicking through filters',
        ],
        howToUse: 'Type your question in plain English and press Enter. Results appear as a table. Click "Export" to download as CSV.',
      },
    },
    '/research': {
      title: 'AI research',
      description: 'Ask the AI a question about your bugs, patterns, or codebase and get a researched answer with sources.',
      help: {
        title: 'About AI research',
        whatIsIt: 'An AI that reads your bug history, code, and fixes to answer specific questions — like having a senior engineer who\'s read everything.',
        useCases: [
          '"Why does the login screen keep breaking?" — get a pattern analysis',
          '"What changed before the spike in crashes last Tuesday?"',
          'Get a plain-language summary of a complex bug cluster',
        ],
        howToUse: 'Type your question and hit Enter. The AI cites which reports and fixes it used to answer.',
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
      description: 'Let your whole team log in with Google, GitHub, or your company\'s identity provider — no separate passwords.',
      help: {
        title: 'About single sign-on',
        whatIsIt: 'Set up SSO so your team logs into Mushi with the same credentials they use for everything else — no new passwords to manage.',
        useCases: [
          'Enable Google or GitHub login for your whole organization',
          'Connect your company\'s Okta or Azure AD if you\'re enterprise',
          'Enforce SSO-only access so passwords can\'t be a weak point',
        ],
        howToUse: 'Pick an identity provider and follow the setup steps. Test the connection before enforcing it so you don\'t lock yourself out.',
      },
    },
    '/audit': {
      title: 'Activity history',
      description: 'A full log of every action taken in your account — who did what, and when. Useful for security reviews and debugging.',
      help: {
        title: 'About the audit log',
        whatIsIt: 'A tamper-proof record of every significant action in your account — logins, key rotations, settings changes, and fix dispatches.',
        useCases: [
          'Find out who changed a setting or rotated an API key',
          'Investigate a suspicious login or unexpected change',
          'Export the log for a security or compliance review',
        ],
        howToUse: 'Use the date range and filter to narrow down events. Click any row for the full detail. Export button downloads the filtered view as CSV.',
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
      title: 'Weekly digest',
      description: 'An AI-written summary of what happened this week — patterns, improvements, and things that need your attention.',
      help: {
        title: 'About the intelligence report',
        whatIsIt: 'A weekly AI-written narrative that turns your raw bug numbers into an easy-to-read story — like a Monday morning briefing.',
        useCases: [
          'Share a one-paragraph status with your team without writing it yourself',
          'Spot a trend that\'s not obvious from the dashboard numbers',
          'Get a "state of the app" summary before a planning meeting',
        ],
        howToUse: 'Reports generate automatically each week. Click "Generate now" to get a fresh one. Copy the text to paste into Slack or a status doc.',
      },
    },
    '/compliance': {
      title: 'Data & privacy',
      description: 'Control what data Mushi stores, how long it\'s kept, and who can access it. Required reading before going live in regulated industries.',
      help: {
        title: 'About compliance settings',
        whatIsIt: 'Settings that control how Mushi handles your users\' data — storage duration, PII masking, data residency, and access controls.',
        useCases: [
          'Set data retention rules to comply with GDPR or CCPA',
          'Enable PII masking so user data is never stored in bug reports',
          'Download a data export if a user requests their data',
        ],
        howToUse: 'Work through each section top to bottom. Changes take effect immediately. Check the "Verify" button on each section to confirm your settings are applied.',
      },
    },
    '/storage': {
      title: 'Screenshots & files',
      description: 'All the screenshots, screen recordings, and attachments Mushi captured from bug reports — browse, download, or delete.',
      help: {
        title: 'About storage',
        whatIsIt: 'All the screenshots and files attached to bug reports, stored securely and linked back to the report they came from.',
        useCases: [
          'Download a screenshot to include in a Jira ticket or Slack message',
          'Clear old screenshots to free up storage space',
          'Check storage usage if you\'re approaching a plan limit',
        ],
        howToUse: 'Browse by date or project. Click any thumbnail to preview. Click the report link to jump to the bug it belongs to.',
      },
    },
    '/marketplace': {
      title: 'Plugin library',
      description: 'Browse and install plugins that connect Mushi to tools like Sentry, Linear, Discord, and more.',
      help: {
        title: 'About the plugin library',
        whatIsIt: 'A library of one-click plugins that connect Mushi to your existing tools — install one and bugs automatically flow where your team already works.',
        useCases: [
          'Install the Sentry plugin to sync bugs between both tools',
          'Install Linear or Jira to auto-create tickets from critical reports',
          'Install Slack to get instant notifications when a critical bug lands',
        ],
        howToUse: 'Click any plugin to see what it does and how to configure it. Most plugins need a single API key to activate.',
      },
    },
    '/mcp': {
      title: 'AI agent connection',
      description: 'Connect Cursor, Claude, or any AI coding assistant to your live bug queue. The agent reads reports and dispatches fixes.',
      help: {
        title: 'About MCP (AI agent connection)',
        whatIsIt: 'A one-time setup that lets your AI coding assistant read your bug reports and open fix PRs without copy-pasting anything.',
        useCases: [
          'Ask Cursor "what should I fix next?" and get an answer from your real bugs',
          'Have the AI agent draft a fix for a specific report in one command',
          'Query your bug data in plain English from inside your editor',
        ],
        howToUse: 'Click "Generate a key" then copy the config snippet into your AI tool\'s MCP settings. Restart your IDE. Done.',
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
      title: 'User rewards',
      description: 'Incentivise your users to submit more bug reports by rewarding them with points for every report they file.',
      help: {
        title: 'About rewards',
        whatIsIt: 'A points system that rewards your users for submitting bug reports — more reports, better software, happier users.',
        useCases: [
          'Enable rewards to motivate your power users to report more bugs',
          'Set how many points each report category earns',
          'See a leaderboard of your most helpful reporters',
        ],
        howToUse: 'Toggle rewards on, set point values, then add the rewards badge to your app using the SDK snippet provided.',
      },
    },
    '/lessons': {
      title: 'Learned rules',
      description: 'Patterns Mushi noticed across many bug reports — turned into rules so the same class of bug never slips through again.',
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
      title: 'Release tracking',
      description: 'See how bug rates change with each release. Spot regressions before they spread.',
      help: {
        title: 'About release tracking',
        whatIsIt: 'A timeline that links your app releases to bug report volumes — so you can instantly see if a deploy made things better or worse.',
        useCases: [
          'Check if yesterday\'s deploy caused a spike in errors',
          'Compare two releases side-by-side to measure improvement',
          'Get a bug-rate graph to share in a release retrospective',
        ],
        howToUse: 'Releases appear automatically when you tag them in your SDK config. Click any release bar to see every report that came in during that window.',
      },
    },
    '/iterate': {
      title: 'Sprint planning',
      description: 'Turn bug reports into sprint tasks with priority scores, estimated effort, and direct links to auto-fix.',
      help: {
        title: 'About iteration planning',
        whatIsIt: 'A board that groups bugs by sprint priority so you can plan your next iteration without switching between Mushi and your project tracker.',
        useCases: [
          'Plan next sprint\'s bug-fix work with priority scores already calculated',
          'Estimate effort based on how many users felt each bug',
          'One-click dispatch the highest-priority bugs to the auto-fix agent',
        ],
        howToUse: 'Drag bugs into your next sprint. Click "Dispatch all" to send the selected bugs to auto-fix at once.',
      },
    },
    '/drift': {
      title: 'Code health drift',
      description: 'Track how your codebase\'s quality is changing over time. Catch gradual degradation before it becomes a crisis.',
      help: {
        title: 'About code drift',
        whatIsIt: 'A trend chart showing whether your app\'s bug rate is slowly getting better or worse — catching a drift early costs much less than fixing a crisis.',
        useCases: [
          'Spot a gradual increase in bug volume before it becomes urgent',
          'Measure the impact of a refactor on overall quality',
          'Share a "quality is improving" chart with leadership',
        ],
        howToUse: 'Look at the trend line. Flat or declining = healthy. Climbing = investigate. Click any spike to see which component drifted.',
      },
    },
    '/experiments': {
      title: 'A/B experiments',
      description: 'Test whether a change actually reduced bugs — compare two groups of users to see which version performed better.',
      help: {
        title: 'About experiments',
        whatIsIt: 'A/B testing for bug rates — compare two versions of your app to see which one your users hit fewer problems with.',
        useCases: [
          'Verify that a UI redesign actually reduced confusion-related reports',
          'Test two error-handling approaches and measure which produces fewer reports',
          'Run a canary deployment and watch bug rates on the new version in real time',
        ],
        howToUse: 'Create an experiment, pick the two variants, set a duration. Mushi automatically splits incoming reports and shows you the difference.',
      },
    },
    '/anomalies': {
      title: 'Unusual patterns',
      description: 'Alerts when bug volume, severity, or types change in a way that looks unusual — catch surprises before they escalate.',
      help: {
        title: 'About anomaly detection',
        whatIsIt: 'An automatic alarm system that spots unusual spikes or drops in your bug data and alerts you before users start complaining.',
        useCases: [
          'Get notified if a deploy suddenly tripled the error rate',
          'Catch a silent regression that\'s slowly getting worse',
          'See a list of all anomalies sorted by how unusual they are',
        ],
        howToUse: 'Active anomalies appear at the top. Click any to see the full detail and which reports triggered the alert. Dismiss when investigated.',
      },
    },
    '/cost': {
      title: 'AI spending',
      description: 'See exactly how much each AI step costs — classification, fix drafts, judge runs — broken down by day and provider.',
      help: {
        title: 'About AI cost tracking',
        whatIsIt: 'A breakdown of every penny spent on AI calls — so you know exactly what Mushi costs and which steps are the most expensive.',
        useCases: [
          'Check your daily AI spend before approving a budget',
          'Find which LLM step costs the most and tune it',
          'Set a budget cap so you\'re never surprised by a big bill',
        ],
        howToUse: 'The chart breaks cost by step and day. Click any bar to see individual call breakdowns. Set a monthly cap in Settings → Budget.',
      },
    },
    '/notifications': {
      title: 'Alert settings',
      description: 'Choose when Mushi pings you — new critical bug, fix merged, judge score drops — and where to send the alert.',
      help: {
        title: 'About notification settings',
        whatIsIt: 'Controls for when Mushi alerts you and where — Slack, email, or webhook. Set it once and only hear about what actually matters.',
        useCases: [
          'Get a Slack ping the moment a critical bug lands',
          'Turn off low-severity notifications so you\'re not spammed',
          'Set up a webhook to pipe alerts into your on-call system',
        ],
        howToUse: 'Toggle each notification type on or off. Click "Configure destination" to add a Slack channel, email, or webhook URL.',
      },
    },
    '/billing': {
      title: 'Plan & billing',
      description: 'See your current plan, usage, and invoices. Upgrade when you\'re ready to unlock more reports, projects, or auto-fixes.',
      help: {
        title: 'About billing',
        whatIsIt: 'Your subscription, usage limits, and invoice history — all in one place. Upgrade or downgrade without contacting anyone.',
        useCases: [
          'Check how many reports you\'ve used this month vs your plan limit',
          'Upgrade to unlock more projects or auto-fix runs',
          'Download an invoice for expenses or accounting',
        ],
        howToUse: 'Current usage is at the top. Click "Upgrade" to change plans. Click "Invoices" to download past bills.',
      },
    },
    '/organization/members': {
      title: 'Team members',
      description: 'Invite your colleagues, assign roles, and manage who has access to your Mushi workspace.',
      help: {
        title: 'About team management',
        whatIsIt: 'Invite teammates, set what each person can see or change, and remove access when someone leaves the team.',
        useCases: [
          'Invite a colleague with their email address (they get a link)',
          'Give a designer read-only access so they can see bugs without changing anything',
          'Remove a former teammate\'s access in one click',
        ],
        howToUse: 'Click "Invite" and enter their email. Pick a role: Viewer (read-only), Member, Admin, or Owner. They\'ll get an email with a link.',
      },
    },
    '/explore': {
      title: 'Codebase map',
      description: 'A visual map of your codebase — see every file, how they connect, and search your code with plain English.',
      help: {
        title: 'About the codebase explorer',
        whatIsIt: 'A visual map of your code that shows every file, how files connect to each other, and lets you search with plain English.',
        useCases: [
          'See which part of the codebase a bug report\'s file lives in',
          'Search "where is the login logic?" and jump to the right file',
          'Explore a new codebase visually without reading hundreds of files',
        ],
        howToUse: 'Graph view shows the full map — click any node to open the detail panel. Search tab lets you type a question. Layers view groups files by type.',
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
    '/inbox': {
      title: 'Inbox',
      description: 'Cross-stage action queue — triage backlog, open PRs, integration gaps, PDCA coverage.',
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
      description: 'Crawled user-story map, gate runs, wired/mocked coverage, findings backlog.',
    },
    '/query': {
      title: 'NL query',
      description: 'Natural-language → SQL against project telemetry. Exportable result sets.',
    },
    '/research': {
      title: 'Research',
      description: 'LLM synthesis over reports, fixes, and indexed codebase context.',
    },
    '/repo': {
      title: 'Repo',
      description: 'GitHub OAuth, default branch, fix-worker target repo health.',
    },
    '/sso': {
      title: 'SSO',
      description: 'SAML/OIDC + social IdP enforcement for the organization.',
    },
    '/audit': {
      title: 'Audit log',
      description: 'Append-only mutation trail — human + agent actors, CSV export.',
    },
    '/prompt-lab': {
      title: 'Prompt lab',
      description: 'Versioned classifier/fix prompts with shadow tests on live reports.',
    },
    '/intelligence': {
      title: 'Intelligence',
      description: 'Weekly LLM narrative — KPI trends, regressions, recommended actions.',
    },
    '/compliance': {
      title: 'Compliance',
      description: 'Retention, PII masking, residency, and evidence export controls.',
    },
    '/storage': {
      title: 'Storage',
      description: 'Screenshot / attachment browser with per-report lineage.',
    },
    '/marketplace': {
      title: 'Marketplace',
      description: 'Installable platform plugins — Sentry, Linear, Slack, …',
    },
    '/mcp': {
      title: 'MCP',
      description: 'Model Context Protocol endpoints for external agent consumers.',
    },
    '/qa-coverage': {
      title: 'QA coverage',
      description: 'Scheduled Playwright / Firecrawl / Browserbase story runs + 24h pass rate.',
    },
    '/anti-gaming': {
      title: 'Anti-gaming',
      description: 'Heuristics for synthetic / duplicate / low-signal report abuse.',
    },
    '/rewards': {
      title: 'Rewards',
      description: 'Contributor incentives tied to merged fix throughput.',
    },
    '/lessons': {
      title: 'Lessons',
      description: 'Post-incident learnings linked to report fingerprints.',
    },
    '/releases': {
      title: 'Releases',
      description: 'Release ↔ regression correlation and deploy-window overlays.',
    },
    '/iterate': {
      title: 'Iterate',
      description: 'Prompt / policy iteration loop with A/B harness on historical reports.',
    },
    '/drift': {
      title: 'Drift',
      description: 'Classifier output drift vs judge baseline — alert on regression.',
    },
    '/experiments': {
      title: 'Experiments',
      description: 'Feature-flagged pipeline variants with cohort metrics.',
    },
    '/anomalies': {
      title: 'Anomalies',
      description: 'Statistical spikes in intake, latency, or failure rate.',
    },
    '/cost': {
      title: 'Cost',
      description: 'LLM spend by function, model, and project — daily rollups.',
    },
    '/notifications': {
      title: 'Notifications',
      description: 'Routing rules, delivery log, and channel health probes.',
    },
    '/billing': {
      title: 'Billing',
      description: 'Plan entitlements, usage meters, Stripe subscription state.',
    },
    '/organization/members': {
      title: 'Members',
      description: 'Org roster, roles (viewer → owner), invite lifecycle.',
    },
    '/explore': {
      title: 'Codebase atlas',
      description: 'Indexed file graph, import edges, semantic search over symbols.',
    },
    '/users': {
      title: 'Users',
      description: 'Operator directory — signups, plans, last-seen activity.',
    },
    '/dashboard': {
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
