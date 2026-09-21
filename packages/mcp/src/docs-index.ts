// GENERATED — do not edit.
// Source: apps/docs/public/llms.txt + apps/docs/content/**/*.mdx
// Regenerate: node scripts/gen-mcp-docs-index.mjs   (CI: --check)

/**
 * Static index behind the `search_mushi_docs` MCP tool. Every path is a
 * page that exists in the docs site at generation time, so the tool can
 * never hand an agent a dead link. Keep this file in lock-step across the
 * stdio (packages/mcp) and hosted (functions/mcp) servers by regenerating
 * — never by hand-editing one copy.
 */

export interface DocIndexEntry {
  title: string
  path: string
  keywords: string[]
  excerpt: string
}

const BASE = "https://kensaur.us/mushi-mushi/docs"

function docPath(suffix: string): string {
  return suffix === '/' ? BASE : BASE + suffix
}

/** 202 pages, generated from llms.txt. */
export const MUSHI_DOCS_INDEX: DocIndexEntry[] = [
  {
    title: "Mushi Mushi — know why your AI-built app broke, with the fix ready",
    path: docPath("/"),
    keywords: ["know", "ai-built", "app", "broke", "fix", "ready"],
    excerpt: "Your AI shipped it. Mushi tells you why it broke: a plain-English diagnosis and a ready fix in your editor. Open source, Sentry optional.",
  },
  {
    title: "Admin console",
    path: docPath("/admin"),
    keywords: ["admin", "console"],
    excerpt: "Guide to the Mushi admin console — the reports inbox, fix drafts and PRs, plain-English queries, and a link to every deeper page of the console.",
  },
  {
    title: "Activity",
    path: docPath("/admin/activity"),
    keywords: ["admin", "activity"],
    excerpt: "The Activity page in the Mushi console shows end-user sessions, top routes, and identified versus anonymous users for a project over the last 30 days.",
  },
  {
    title: "Anomaly detection",
    path: docPath("/admin/anomalies"),
    keywords: ["admin", "anomalies", "anomaly", "detection"],
    excerpt: "The Anomaly detection page runs statistical detectors over the metrics you send and can file a report in your queue when one behaves unexpectedly.",
  },
  {
    title: "Anti-gaming",
    path: docPath("/admin/anti-gaming"),
    keywords: ["admin", "anti-gaming", "anti", "gaming"],
    excerpt: "The Anti-gaming page flags reporters whose patterns look abusive — near-duplicate spam, reward farming or synthetic sessions — for you to review.",
  },
  {
    title: "Audit log",
    path: docPath("/admin/audit"),
    keywords: ["admin", "audit", "log"],
    excerpt: "The Audit log records every admin action and agent run in Mushi — who minted API keys, who dispatched a fix, and what triggered a pull request.",
  },
  {
    title: "Billing",
    path: docPath("/admin/billing"),
    keywords: ["admin", "billing"],
    excerpt: "The Billing page shows your diagnosis quota, usage alerts at 50% and 80%, your projected bill, and spend caps for your Mushi plan.",
  },
  {
    title: "CLI device auth",
    path: docPath("/admin/cli-auth"),
    keywords: ["admin", "cli-auth", "cli", "auth", "device"],
    excerpt: "The page that mushi login opens so you can approve a CLI device code while signed in to the console, and how the device authorization flow works.",
  },
  {
    title: "Code health",
    path: docPath("/admin/code-health"),
    keywords: ["admin", "code-health", "code", "health"],
    excerpt: "The Code health page charts bundle size and oversized files from your CI over time, so you notice an app getting heavier before your users do.",
  },
  {
    title: "Compliance",
    path: docPath("/admin/compliance"),
    keywords: ["admin", "compliance"],
    excerpt: "The Compliance page shows SOC 2 control status, retention policies and DSAR requests, and exports an evidence PDF for procurement reviews.",
  },
  {
    title: "Connect & Update",
    path: docPath("/admin/connect"),
    keywords: ["admin", "connect", "update"],
    excerpt: "Connect & Update wires GitHub, the SDK, MCP, the CLI and your editor to a Mushi project, and shows when your installed SDK is out of date.",
  },
  {
    title: "Content quality",
    path: docPath("/admin/content"),
    keywords: ["admin", "content", "quality"],
    excerpt: "The Content quality page queues AI-generated copy, release notes and knowledge snippets that scored poorly or were flagged, so you can fix them.",
  },
  {
    title: "Cost & usage",
    path: docPath("/admin/cost"),
    keywords: ["admin", "cost", "usage"],
    excerpt: "The Cost page shows LLM token use and estimated spend per model and pipeline for a Mushi project, so you can see what each diagnosis costs.",
  },
  {
    title: "Dashboard",
    path: docPath("/admin/dashboard"),
    keywords: ["admin", "dashboard"],
    excerpt: "The Mushi dashboard answers whether anything broke since your last release — new reports, overnight fix runs and pipeline health on one screen.",
  },
  {
    title: "Docs bridge",
    path: docPath("/admin/docs-bridge"),
    keywords: ["admin", "docs-bridge", "bridge"],
    excerpt: "The docs bridge is the console's silent sign-in relay that lets the Mushi docs site fill live snippets with your project details when you are signed in.",
  },
  {
    title: "Drift scanner",
    path: docPath("/admin/drift"),
    keywords: ["admin", "drift", "scanner"],
    excerpt: "The Drift scanner compares your live routes and components against the last snapshot to find the pages that a refactor silently broke.",
  },
  {
    title: "Experiments",
    path: docPath("/admin/experiments"),
    keywords: ["admin", "experiments"],
    excerpt: "The Experiments page defines and runs A/B tests in Mushi and analyses them with CUPED variance reduction and sequential testing.",
  },
  {
    title: "Codebase Atlas",
    path: docPath("/admin/explore"),
    keywords: ["admin", "explore", "codebase", "atlas"],
    excerpt: "Visual, searchable map of every indexed source file — explore architectural layers, import dependencies, and find code by meaning.",
  },
  {
    title: "Feature board",
    path: docPath("/admin/feature-board"),
    keywords: ["admin", "feature-board", "feature", "board"],
    excerpt: "The Feature board collects feature requests from support tickets so members can upvote them and you can mark them as shipped.",
  },
  {
    title: "Feedback hub",
    path: docPath("/admin/feedback"),
    keywords: ["admin", "feedback", "hub"],
    excerpt: "The Feedback hub lists the support tickets filed from the console — active, shipped and all — with unread replies in one place.",
  },
  {
    title: "Fine-tuning",
    path: docPath("/admin/fine-tuning"),
    keywords: ["admin", "fine-tuning", "fine", "tuning"],
    excerpt: "The Fine-tuning page exports your best-scored classifications, trains a fine-tuned model, benchmarks it offline and promotes it to production.",
  },
  {
    title: "Fix drafts & PRs",
    path: docPath("/admin/fixes"),
    keywords: ["admin", "fixes", "fix", "drafts", "prs"],
    excerpt: "The Fixes page tracks every draft pull request Mushi opened from a bug report, from the moment a fix run starts until the PR is ready or the run fails.",
  },
  {
    title: "Full-stack audit",
    path: docPath("/admin/fullstack-audit"),
    keywords: ["admin", "fullstack-audit", "fullstack", "audit", "full-stack"],
    excerpt: "The Full-stack audit runs one health check across RLS gaps, recent backend errors and API contract drift, and returns a readable scorecard.",
  },
  {
    title: "Knowledge graph",
    path: docPath("/admin/graph"),
    keywords: ["admin", "graph", "knowledge"],
    excerpt: "The Knowledge graph page draws your project's bugs, components and fixes as an interactive graph, so you can see which areas cluster problems.",
  },
  {
    title: "Integration health",
    path: docPath("/admin/health"),
    keywords: ["admin", "health", "integration"],
    excerpt: "The Integration health page monitors Mushi's LLM pipelines, cron jobs and provider connections so you catch a degraded integration early.",
  },
  {
    title: "Action inbox",
    path: docPath("/admin/inbox"),
    keywords: ["admin", "inbox", "action"],
    excerpt: "The Action inbox gathers everything in Mushi that needs a human decision — reports, queue failures, health and drift alerts — in one list.",
  },
  {
    title: "Integrations",
    path: docPath("/admin/integrations"),
    keywords: ["admin", "integrations"],
    excerpt: "Set up Mushi integrations from one page — send new bugs to Linear, bring in Sentry feedback, and open fix pull requests on your GitHub repo.",
  },
  {
    title: "Intelligence reports",
    path: docPath("/admin/intelligence"),
    keywords: ["admin", "intelligence", "reports"],
    excerpt: "Intelligence reports are Mushi's weekly plain-English bug digest for each project — what broke, what got fixed and what to watch, sent to your inbox.",
  },
  {
    title: "User stories · Inventory",
    path: docPath("/admin/inventory"),
    keywords: ["admin", "inventory", "user", "stories"],
    excerpt: "The User stories page manages your inventory.yaml — every page, action and story your app should have — and shows which of them the gates cover.",
  },
  {
    title: "Iterate",
    path: docPath("/admin/iterate"),
    keywords: ["admin", "iterate"],
    excerpt: "The Iterate page queues improvement runs on a user flow — an agent tests the screens, finds friction and proposes changes for you to review.",
  },
  {
    title: "Judge dashboard",
    path: docPath("/admin/judge"),
    keywords: ["admin", "judge", "dashboard"],
    excerpt: "The Judge page scores how well Mushi's plain-English reads match reality over time, so you see quality slipping or a better prompt ready to promote.",
  },
  {
    title: "Lessons",
    path: docPath("/admin/lessons"),
    keywords: ["admin", "lessons"],
    excerpt: "The Lessons page turns repeat fixes into rules — when the same root cause keeps returning, Mushi records it so your editor sees it on the next PR.",
  },
  {
    title: "Plugin marketplace",
    path: docPath("/admin/marketplace"),
    keywords: ["admin", "marketplace", "plugin"],
    excerpt: "The Plugin marketplace installs outbound plugins such as PagerDuty, Linear and Zapier that receive Mushi webhook events for your project.",
  },
  {
    title: "MCP",
    path: docPath("/admin/mcp"),
    keywords: ["admin", "mcp"],
    excerpt: "The MCP page connects Cursor, Claude Code, Windsurf and other MCP clients to Mushi and lists the tools your agent can call from the editor.",
  },
  {
    title: "MCP OAuth consent",
    path: docPath("/admin/mcp-auth"),
    keywords: ["admin", "mcp-auth", "mcp", "auth", "oauth", "consent"],
    excerpt: "The consent page the hosted Mushi MCP server opens when your editor signs in over OAuth — what you approve and how the authorization flow works.",
  },
  {
    title: "Notifications",
    path: docPath("/admin/notifications"),
    keywords: ["admin", "notifications"],
    excerpt: "The Notifications page lists every alert Mushi sent to reporters and team members for a project, so you can debug delivery or audit messages.",
  },
  {
    title: "Onboarding",
    path: docPath("/admin/onboarding"),
    keywords: ["admin", "onboarding"],
    excerpt: "Get your first real bug report into Mushi in about 10 minutes with the console onboarding checklist, from new project to classified report.",
  },
  {
    title: "Overview (portfolio)",
    path: docPath("/admin/overview"),
    keywords: ["admin", "overview", "portfolio"],
    excerpt: "The Overview page is the organization-wide portfolio view — seven-day activity and open tickets for every connected project at a glance.",
  },
  {
    title: "Projects",
    path: docPath("/admin/projects"),
    keywords: ["admin", "projects"],
    excerpt: "Create a Mushi project, mint an API key, copy the install snippet for your framework and send a test report, all from the Projects page.",
  },
  {
    title: "Prompt lab",
    path: docPath("/admin/prompt-lab"),
    keywords: ["admin", "prompt-lab", "prompt", "lab"],
    excerpt: "The Prompt lab lets you edit, test and A/B compare the classification prompts behind Mushi's diagnoses before you promote a new version.",
  },
  {
    title: "QA Coverage",
    path: docPath("/admin/qa-coverage"),
    keywords: ["admin", "qa-coverage", "coverage", "qa"],
    excerpt: "QA Coverage turns user flows written in plain English into scheduled browser tests, so you find out when login or checkout breaks.",
  },
  {
    title: "Natural-language query",
    path: docPath("/admin/query"),
    keywords: ["admin", "query", "natural-language"],
    excerpt: "Ask questions about your Mushi project's bug data in plain English — the Query page writes the SQL and draws the chart for you.",
  },
  {
    title: "Processing queue",
    path: docPath("/admin/queue"),
    keywords: ["admin", "queue", "processing"],
    excerpt: "The Processing queue shows reports waiting for classification, retries and dead-letter items, and lets you requeue the ones that failed.",
  },
  {
    title: "Real-time collaboration",
    path: docPath("/admin/realtime"),
    keywords: ["admin", "realtime", "real-time", "collaboration"],
    excerpt: "How Mushi report pages support real-time collaboration — see who else is viewing a report and watch new comments arrive without a refresh.",
  },
  {
    title: "Releases",
    path: docPath("/admin/releases"),
    keywords: ["admin", "releases"],
    excerpt: "The Releases page drafts a changelog for each version from the fixes that shipped, crediting the users whose reports led to each fix.",
  },
  {
    title: "Repo graph",
    path: docPath("/admin/repo"),
    keywords: ["admin", "repo", "graph"],
    excerpt: "The Repo page shows every fix branch in your connected GitHub repository — open PRs, CI status, and what the fix worker did on each branch.",
  },
  {
    title: "Reports & triage",
    path: docPath("/admin/reports"),
    keywords: ["admin", "reports", "triage"],
    excerpt: "The Reports list is Mushi's bug inbox — filter by status, severity, category and component, and start with the recommended action at the top.",
  },
  {
    title: "Research",
    path: docPath("/admin/research"),
    keywords: ["admin", "research"],
    excerpt: "The Research page runs a Firecrawl web search scoped to your tech stack and returns summarised answers with links to their sources.",
  },
  {
    title: "Rewards program",
    path: docPath("/admin/rewards"),
    keywords: ["admin", "rewards", "program"],
    excerpt: "Set up the Mushi rewards program from the console — points for reporter activity, the tier ladder, and the perks your app grants at each tier.",
  },
  {
    title: "SDK health",
    path: docPath("/admin/sdk-health"),
    keywords: ["admin", "sdk-health", "sdk", "health"],
    excerpt: "The SDK health card shows the live heartbeat of every Mushi SDK that reported in the last 24 hours, so an SDK that never shipped is obvious.",
  },
  {
    title: "Settings",
    path: docPath("/admin/settings"),
    keywords: ["admin", "settings"],
    excerpt: "The Settings page holds every project option — notifications, your own LLM keys, widget copy, Slack alerts and developer settings.",
  },
  {
    title: "Setup Copilot",
    path: docPath("/admin/setup-copilot"),
    keywords: ["admin", "setup-copilot", "setup", "copilot"],
    excerpt: "Setup Copilot is a guided checklist that verifies SDK ingest and fix dispatch for a project, with copy-paste CLI commands for each step.",
  },
  {
    title: "Skill Pipelines",
    path: docPath("/admin/skill-pipelines"),
    keywords: ["admin", "skill-pipelines", "skill", "pipelines"],
    excerpt: "Skill Pipelines recommend agent skills from the cursor-kenji and skills.sh ecosystem for each classified bug and run them during review in Mushi.",
  },
  {
    title: "SSO",
    path: docPath("/admin/sso"),
    keywords: ["admin", "sso"],
    excerpt: "Set up SAML 2.0 or OIDC single sign-on for your Mushi organization so teammates log in with your company's identity provider.",
  },
  {
    title: "Storage",
    path: docPath("/admin/storage"),
    keywords: ["admin", "storage"],
    excerpt: "The Storage page chooses where Mushi keeps report attachments and recordings — managed storage, or your own bucket for residency or cost.",
  },
  {
    title: "Teams and Members",
    path: docPath("/admin/teams"),
    keywords: ["admin", "teams", "members"],
    excerpt: "How teams work in Mushi — organizations own projects, billing, invitations and the member roster, and project access comes from membership.",
  },
  {
    title: "Users",
    path: docPath("/admin/users"),
    keywords: ["admin", "users"],
    excerpt: "The Users page is an operator-only directory of every Mushi account with plan, MRR and churn; other visitors see a not-found page instead.",
  },
  {
    title: "Voice intake",
    path: docPath("/admin/voice"),
    keywords: ["admin", "voice", "intake"],
    excerpt: "Report a bug by voice from the Mushi console — say what is wrong, confirm the transcript, and a draft pull request is started for you.",
  },
  {
    title: "Blog",
    path: docPath("/blog"),
    keywords: ["blog"],
    excerpt: "Notes from building Mushi Mushi — the real numbers behind the funnel, open-source licensing, launches, and how AI-built apps get debugged in practice.",
  },
  {
    title: "Mushi goes AGPLv3 — the honest open source story",
    path: docPath("/blog/agplv3-relicense"),
    keywords: ["blog", "agplv3-relicense", "agplv3", "relicense", "goes", "honest", "open", "source", "story"],
    excerpt: "Why Mushi Mushi relicensed its server to AGPLv3 while keeping every SDK MIT — the open-core reasoning, what changes for self-hosters, and what stays free.",
  },
  {
    title: "60 seconds from \"this is broken\" to a draft PR — building Mushi Mushi",
    path: docPath("/blog/auto-fix-loop"),
    keywords: ["blog", "auto-fix-loop", "auto", "fix", "loop", "60", "seconds", "this", "broken", "draft", "pr", "building"],
    excerpt: "How Mushi Mushi turns a one-sentence user complaint into a classified, deduped, AI-judged draft PR, and why the human stays in the loop the whole way.",
  },
  {
    title: "Launch Week 1 — five features, five days",
    path: docPath("/blog/launch-week-1"),
    keywords: ["blog", "launch-week-1", "launch", "week", "five", "features", "days"],
    excerpt: "Everything Mushi Mushi shipped in Launch Week 1 — one feature a day, from bug-report capture to editor-ready fixes, with demos and setup commands.",
  },
  {
    title: "I shipped a bug tool for 5 months and got 9 signups. Here's what the data said.",
    path: docPath("/blog/nine-signups-what-the-data-said"),
    keywords: ["blog", "nine-signups-what-the-data-said", "nine", "signups", "data", "said", "shipped", "bug", "tool", "months", "got", "here"],
    excerpt: "Five months after launch, Mushi Mushi had 30 npm packages, an MCP server in every registry and nine signups. What the data said, and what changed.",
  },
  {
    title: "Changelog",
    path: docPath("/changelog"),
    keywords: ["changelog"],
    excerpt: "What shipped in Mushi Mushi — new SDK releases, console features, MCP tools, and fixes, in plain English with dates.",
  },
  {
    title: "Mushi Cloud",
    path: docPath("/cloud"),
    keywords: ["cloud"],
    excerpt: "Hosted Mushi Mushi — bug reports, plain-English diagnoses, and fix dispatch without running servers. Free tier includes 50 diagnoses a month.",
  },
  {
    title: "Compare",
    path: docPath("/compare"),
    keywords: ["compare", "sentry", "jam", "posthog"],
    excerpt: "Honest, dated comparisons of Mushi Mushi with Sentry, Jam and PostHog, plus Sentry alternatives for solo founders. Every number links to its source.",
  },
  {
    title: "Jam vs Mushi Mushi",
    path: docPath("/compare/jam-vs-mushi"),
    keywords: ["compare", "jam-vs-mushi", "jam"],
    excerpt: "Jam.dev vs Mushi Mushi in 2026 — a teammate recording a bug in the Jam extension versus a user reporting from your app, MCP handoff and free tiers.",
  },
  {
    title: "PostHog session replay vs Mushi Mushi",
    path: docPath("/compare/posthog-session-replay-vs-mushi"),
    keywords: ["compare", "posthog-session-replay-vs-mushi", "posthog", "session", "replay"],
    excerpt: "PostHog session replay vs Mushi Mushi in 2026 — every session recorded versus the one a user flagged as broken, free tiers, and why teams run both.",
  },
  {
    title: "Sentry alternatives for solo founders",
    path: docPath("/compare/sentry-alternatives-for-solo-founders"),
    keywords: ["compare", "sentry-alternatives-for-solo-founders", "sentry", "alternatives", "solo", "founders"],
    excerpt: "Sentry alternatives for solo founders in 2026 — Bugsnag, Rollbar, highlight.io, PostHog and Mushi compared on free tiers, self-hosting and AI fixes.",
  },
  {
    title: "Sentry vs Mushi Mushi",
    path: docPath("/compare/sentry-vs-mushi"),
    keywords: ["compare", "sentry-vs-mushi", "sentry"],
    excerpt: "Sentry vs Mushi Mushi in 2026 — what each captures, Sentry's free tier and Seer pricing next to Mushi's 50 free diagnoses a month, and running both.",
  },
  {
    title: "Concepts",
    path: docPath("/concepts"),
    keywords: ["concepts"],
    excerpt: "Mushi's core ideas in one place — capture, plain-English diagnosis, dedupe into one row, optional agent fixes, verification, and lessons it remembers.",
  },
  {
    title: "Agent contract",
    path: docPath("/concepts/agent-contract"),
    keywords: ["concepts", "agent-contract", "agent", "contract"],
    excerpt: "What Mushi expects an agent to read before opening a PR, and what it promises in return.",
  },
  {
    title: "Anti-gaming & reputation",
    path: docPath("/concepts/anti-gaming"),
    keywords: ["concepts", "anti-gaming", "anti", "gaming", "reputation"],
    excerpt: "How Mushi keeps bug reports honest — reporter reputation against spam and point farming, and prompt-fatigue limits so real users are not nagged.",
  },
  {
    title: "Architecture",
    path: docPath("/concepts/architecture"),
    keywords: ["concepts", "architecture"],
    excerpt: "How Mushi is built — a Hono gateway in front of Supabase, the edge functions behind it, and the relational, vector and graph stores that hold each report.",
  },
  {
    title: "Mushi Bounties — crowd-testing marketplace",
    path: docPath("/concepts/bounty-marketplace"),
    keywords: ["concepts", "bounty-marketplace", "bounty", "marketplace", "bounties", "crowd-testing"],
    excerpt: "Mushi Bounties is a crowd-testing marketplace — publish your app, and real testers file bug reports and earn points they can redeem for rewards.",
  },
  {
    title: "How Mushi reads a bug report",
    path: docPath("/concepts/classification"),
    keywords: ["concepts", "classification", "reads", "bug", "report"],
    excerpt: "How Mushi turns a raw bug report and screenshot into a plain-English diagnosis — the fast filter, the text and vision stages, and what gets stored.",
  },
  {
    title: "Closed-loop evolution — the thesis",
    path: docPath("/concepts/closed-loop"),
    keywords: ["concepts", "closed-loop", "closed", "loop", "evolution", "thesis"],
    excerpt: "The thesis behind Mushi — why AI-built apps need a closed loop from what users feel to a verified fix, and how capture, diagnosis and fixes connect.",
  },
  {
    title: "Project ID & API keys",
    path: docPath("/concepts/credentials"),
    keywords: ["concepts", "credentials", "project", "id", "api", "keys"],
    excerpt: "Where to find your Mushi project ID and API key, what the report:write and mcp scopes allow, the one mushi_ key format, and env var names per framework.",
  },
  {
    title: "API error catalog",
    path: docPath("/concepts/error-catalog"),
    keywords: ["concepts", "error-catalog", "error", "catalog", "api"],
    excerpt: "Stable error codes returned by the Mushi API envelope, how to read them in the console, and how they correlate with Sentry and Langfuse.",
  },
  {
    title: "The evolution loop — how Mushi closes the cycle",
    path: docPath("/concepts/evolution-loop"),
    keywords: ["concepts", "evolution-loop", "evolution", "loop", "closes", "cycle"],
    excerpt: "The five stages that turn a user-felt bug into a merged fix and a lesson rule — the loop that improves your app without Jira, QA teams or PM bottlenecks.",
  },
  {
    title: "Fix drafts & PRs",
    path: docPath("/concepts/fix-orchestrator"),
    keywords: ["concepts", "fix-orchestrator", "fix", "orchestrator", "drafts", "prs"],
    excerpt: "What happens when you dispatch a fix — Mushi runs a coding agent in a sandbox and opens a draft pull request with a rationale and CI status to review.",
  },
  {
    title: "Inventory and gates (v2)",
    path: docPath("/concepts/inventory-and-gates"),
    keywords: ["concepts", "inventory-and-gates", "inventory", "gates", "v2"],
    excerpt: "Mushi v2's inventory.yaml lists every page, story and action in your app, and five composite gates fail the build when a change breaks that contract.",
  },
  {
    title: "Judge & self-improvement",
    path: docPath("/concepts/judge-loop"),
    keywords: ["concepts", "judge-loop", "judge", "loop", "self-improvement"],
    excerpt: "How Mushi's classifier improves itself — a nightly judge scores yesterday's reads, prompts are A/B tested, and drift is caught before it reaches you.",
  },
  {
    title: "Knowledge graph",
    path: docPath("/concepts/knowledge-graph"),
    keywords: ["concepts", "knowledge-graph", "knowledge", "graph"],
    excerpt: "How Mushi links reports, components, fixes and developers in a per-project knowledge graph, with pgvector for similarity and Apache AGE for traversal.",
  },
  {
    title: "Multi-repo coordinated fixes",
    path: docPath("/concepts/multi-repo-fixes"),
    keywords: ["concepts", "multi-repo-fixes", "multi", "repo", "fixes", "multi-repo", "coordinated"],
    excerpt: "When one bug spans a frontend and a backend repo, Mushi plans the fix across both and opens one cross-linked pull request per repository.",
  },
  {
    title: "Open source & licensing",
    path: docPath("/concepts/open-source"),
    keywords: ["concepts", "open-source", "open", "source", "licensing"],
    excerpt: "What is open source in Mushi — MIT SDKs you can embed anywhere, an AGPLv3 server you can self-host, and the small commercial enterprise edition.",
  },
  {
    title: "Connecting your orchestrator (MCP / A2A / REST / AG-UI)",
    path: docPath("/concepts/orchestrator-interop"),
    keywords: ["concepts", "orchestrator-interop", "orchestrator", "interop", "connecting", "mcp", "a2a", "rest", "ag-ui"],
    excerpt: "Connect any agent orchestrator to Mushi — MCP, A2A, REST and AG-UI surfaces for Cursor, Claude, OpenAI Agents, LangGraph, CrewAI and your own agents.",
  },
  {
    title: "Rewards & contributor identity",
    path: docPath("/concepts/rewards"),
    keywords: ["concepts", "rewards", "contributor", "identity"],
    excerpt: "How Mushi's rewards program works — reporters earn points for reports and triage, climb project-defined tiers, and get perks from your app via webhooks.",
  },
  {
    title: "Runtime config",
    path: docPath("/concepts/runtime-config"),
    keywords: ["concepts", "runtime-config", "runtime", "config"],
    excerpt: "How the Mushi SDK fetches widget and capture settings from the console at startup, how they merge with your init options, and when to turn it off.",
  },
  {
    title: "Where the report button lives",
    path: docPath("/concepts/trigger-modes"),
    keywords: ["concepts", "trigger-modes", "trigger", "modes", "where", "report", "button", "lives"],
    excerpt: "Choose where Mushi's bug-report button lives — corner stamp, edge tab, banner, your own button via attach, or fully manual — on web and mobile.",
  },
  {
    title: "Cursor integration",
    path: docPath("/integrations/cursor"),
    keywords: ["integrations", "cursor", "integration"],
    excerpt: "Wire Mushi's evolution loop into Cursor with one command — get fix context, lessons, and dispatch right from the editor.",
  },
  {
    title: "Voice intake",
    path: docPath("/integrations/voice-intake"),
    keywords: ["integrations", "voice-intake", "voice", "intake"],
    excerpt: "Say the bug on your phone, get a draft PR back. iOS Shortcut, Telegram, Slack, or the installed console — one pipeline, one confirmation gate, no audio kept.",
  },
  {
    title: "Launch Week",
    path: docPath("/launch-week"),
    keywords: ["launch-week", "launch", "week"],
    excerpt: "How Mushi Mushi launches now — one public post per release (Show HN, then Product Hunt), the gate each release must pass, and what we publish after.",
  },
  {
    title: "Legal",
    path: docPath("/legal"),
    keywords: ["legal"],
    excerpt: "Privacy policy and terms of service for Mushi Mushi Cloud, the SDKs, and the tester program.",
  },
  {
    title: "Privacy Policy",
    path: docPath("/legal/privacy"),
    keywords: ["legal", "privacy", "policy"],
    excerpt: "What Mushi Mushi collects, why, who processes it, how long it is kept, and how to exercise your rights under GDPR and Japan's APPI.",
  },
  {
    title: "Terms of Service",
    path: docPath("/legal/terms"),
    keywords: ["legal", "terms", "service"],
    excerpt: "The terms for Mushi Cloud, the admin console, the SDKs and the Bounties tester marketplace — plans, limits, AI-output disclaimer, licenses and liability.",
  },
  {
    title: "Migration guides",
    path: docPath("/migrations"),
    keywords: ["migrations", "migration", "guides"],
    excerpt: "Step-by-step guides for moving an app onto Mushi from Sentry, Instabug, Shake, LogRocket, BugHerd or Pendo, or between React, Vue and mobile runtimes.",
  },
  {
    title: "BugHerd → Mushi",
    path: docPath("/migrations/bugherd-to-mushi"),
    keywords: ["migrations", "bugherd-to-mushi", "bugherd"],
    excerpt: "Move from BugHerd to Mushi — map pin-to-element feedback onto Mushi's element selector, screenshot and metadata capture, with an interactive checklist.",
  },
  {
    title: "Migration: Capacitor → React Native",
    path: docPath("/migrations/capacitor-to-react-native"),
    keywords: ["migrations", "capacitor-to-react-native", "capacitor", "react", "native", "migration"],
    excerpt: "Port an Ionic or Capacitor app to React Native — a full plan with a Mushi API map and CI/CD recipes for Expo EAS or React Native CLI with Fastlane.",
  },
  {
    title: "Cordova → Capacitor",
    path: docPath("/migrations/cordova-to-capacitor"),
    keywords: ["migrations", "cordova-to-capacitor", "cordova", "capacitor"],
    excerpt: "Migrate a Cordova app to Capacitor in place — same web code, a new native shell — and re-mount Mushi bug reporting with @mushi-mushi/capacitor.",
  },
  {
    title: "Cordova → React Native",
    path: docPath("/migrations/cordova-to-react-native"),
    keywords: ["migrations", "cordova-to-react-native", "cordova", "react", "native"],
    excerpt: "Move a Cordova app to React Native in two hops — stabilise on Capacitor first, then port screen by screen — without losing Mushi bug reporting.",
  },
  {
    title: "Create React App → Vite",
    path: docPath("/migrations/cra-to-vite"),
    keywords: ["migrations", "cra-to-vite", "cra", "vite", "create", "react", "app"],
    excerpt: "Migrate a Create React App project to Vite — run the codemod, rename REACT_APP_ env vars to VITE_, and keep your Mushi React setup working.",
  },
  {
    title: "Instabug (Luciq) → Mushi",
    path: docPath("/migrations/instabug-to-mushi"),
    keywords: ["migrations", "instabug-to-mushi", "instabug", "luciq"],
    excerpt: "Replace Instabug (Luciq) with Mushi for in-app bug reporting — config mapping, shake-to-report parity, a beta validation pass, and a checklist.",
  },
  {
    title: "LogRocket Feedback → Mushi",
    path: docPath("/migrations/logrocket-feedback-to-mushi"),
    keywords: ["migrations", "logrocket-feedback-to-mushi", "logrocket", "feedback"],
    excerpt: "Move LogRocket's feedback widget to Mushi while keeping LogRocket for session replay — both SDKs run side by side, with a step-by-step checklist.",
  },
  {
    title: "@mushi-mushi/* upgrades",
    path: docPath("/migrations/mushi-sdk-upgrade"),
    keywords: ["migrations", "mushi-sdk-upgrade", "sdk", "upgrade", "@mushi-mushi", "upgrades"],
    excerpt: "Upgrade @mushi-mushi packages to the current 1.x releases — breaking changes by package, the codemod, and how to check which versions you run.",
  },
  {
    title: "Native iOS / Android → Hybrid",
    path: docPath("/migrations/native-to-hybrid"),
    keywords: ["migrations", "native-to-hybrid", "native", "hybrid", "ios", "android"],
    excerpt: "Should you wrap a native iOS or Android app in Capacitor or React Native? When it pays off, how to do it, and where Mushi's SDKs fit either way.",
  },
  {
    title: "Next.js Pages → App Router",
    path: docPath("/migrations/nextjs-pages-to-app-router"),
    keywords: ["migrations", "nextjs-pages-to-app-router", "nextjs", "pages", "app", "router", "next.js"],
    excerpt: "Move a Next.js app from the Pages Router to the App Router step by step — where to mount Mushi, CSP for static export, and client component boundaries.",
  },
  {
    title: "Pendo Feedback → Mushi",
    path: docPath("/migrations/pendo-feedback-to-mushi"),
    keywords: ["migrations", "pendo-feedback-to-mushi", "pendo", "feedback"],
    excerpt: "Swap Pendo's feedback module for Mushi while keeping Pendo for analytics, guides and NPS — both share user identity through one identify call.",
  },
  {
    title: "React Native CLI ↔ Expo",
    path: docPath("/migrations/react-native-cli-to-expo"),
    keywords: ["migrations", "react-native-cli-to-expo", "react", "native", "cli", "expo"],
    excerpt: "Move between React Native CLI and Expo in either direction — EAS Build and OTA updates, or expo prebuild for full native control — with Mushi intact.",
  },
  {
    title: "Sentry + Mushi (enrich or standalone)",
    path: docPath("/migrations/sentry-to-mushi"),
    keywords: ["migrations", "sentry-to-mushi", "sentry", "enrich", "standalone"],
    excerpt: "Add Mushi alongside Sentry or run it on its own — three setups, the Sentry webhook for errors, and user bug reports with plain-English diagnoses.",
  },
  {
    title: "Shake → Mushi",
    path: docPath("/migrations/shake-to-mushi"),
    keywords: ["migrations", "shake-to-mushi", "shake"],
    excerpt: "Replace the Shake bug-reporting SDK with Mushi and keep the same shake-to-report experience — config mapping, identity, and a cut-over checklist.",
  },
  {
    title: "SPA → SSR (Next.js / Nuxt / SvelteKit)",
    path: docPath("/migrations/spa-to-ssr"),
    keywords: ["migrations", "spa-to-ssr", "spa", "ssr", "next.js", "nuxt", "sveltekit"],
    excerpt: "Move a Vite SPA to Next.js, Nuxt or SvelteKit — env var prefix changes, where to mount Mushi so it survives navigation, and hydration gotchas.",
  },
  {
    title: "Vue 2 → Vue 3",
    path: docPath("/migrations/vue-2-to-vue-3"),
    keywords: ["migrations", "vue-2-to-vue-3", "vue"],
    excerpt: "Upgrade a Vue 2 app to Vue 3 and move from the vanilla Mushi web SDK to the @mushi-mushi/vue plugin, with an interactive migration checklist.",
  },
  {
    title: "Operating (maintainers)",
    path: docPath("/operating"),
    keywords: ["operating", "maintainers"],
    excerpt: "Runbooks for maintainers running Mushi Cloud or publishing the open-source packages — deployment, releases and status. Not needed to use the SDK.",
  },
  {
    title: "Deployment & releases",
    path: docPath("/operating/deployment"),
    keywords: ["operating", "deployment", "releases"],
    excerpt: "How Mushi's maintainers ship the SDKs, edge functions and docs — a public summary of the release process. App developers never need to run any of it.",
  },
  {
    title: "Status & Uptime",
    path: docPath("/operating/status"),
    keywords: ["operating", "status", "uptime"],
    excerpt: "Mushi Cloud status and uptime — the live status page for the API, hosted MCP, console and docs, what is monitored, and the uptime commitment per plan.",
  },
  {
    title: "Plugin marketplace",
    path: docPath("/plugins"),
    keywords: ["plugins", "plugin", "marketplace"],
    excerpt: "Send Mushi events to the tools you already use through HMAC-signed Standard Webhooks — 12 first-party plugins and an SDK to build your own.",
  },
  {
    title: "Bugsnag",
    path: docPath("/plugins/bugsnag"),
    keywords: ["plugins", "bugsnag"],
    excerpt: "Mirror Mushi bug reports into Bugsnag and close the Bugsnag error when the fix PR merges — install from the marketplace and map release stages.",
  },
  {
    title: "Building a plugin",
    path: docPath("/plugins/building"),
    keywords: ["plugins", "building", "plugin"],
    excerpt: "Build your own Mushi plugin — an HTTP endpoint that receives HMAC-signed webhook events, verified with @mushi-mushi/plugin-sdk in a few lines.",
  },
  {
    title: "Crashlytics",
    path: docPath("/plugins/crashlytics"),
    keywords: ["plugins", "crashlytics"],
    excerpt: "Push Mushi mobile bug reports into Firebase Crashlytics issues and close them when fixes merge — service account setup and app ID mapping.",
  },
  {
    title: "Cursor Cloud Agent",
    path: docPath("/plugins/cursor-cloud"),
    keywords: ["plugins", "cursor-cloud", "cursor", "cloud", "agent"],
    excerpt: "Dispatch a Cursor Cloud Agent automatically when a Mushi report qualifies — it investigates, drafts a fix and opens a PR that links back to Mushi.",
  },
  {
    title: "Discord",
    path: docPath("/plugins/discord"),
    keywords: ["plugins", "discord"],
    excerpt: "Post Mushi report and fix events to a Discord channel through a webhook — create the webhook, install the plugin, and choose which events to send.",
  },
  {
    title: "Webhook events",
    path: docPath("/plugins/events"),
    keywords: ["plugins", "events", "webhook"],
    excerpt: "Reference for every webhook event Mushi plugins receive — the shared envelope, each event's payload, and how to subscribe to only the events you need.",
  },
  {
    title: "GitHub Issues",
    path: docPath("/plugins/github-issues"),
    keywords: ["plugins", "github-issues", "github", "issues"],
    excerpt: "Open a labelled GitHub issue for every classified Mushi report, with a link back to the report — target repo, default labels and assignee settings.",
  },
  {
    title: "Jira Cloud",
    path: docPath("/plugins/jira"),
    keywords: ["plugins", "jira", "cloud"],
    excerpt: "Two-way sync between Mushi reports and Jira Cloud issues — create issues on classification, sync status, and comment fix summaries when fixes land.",
  },
  {
    title: "Linear",
    path: docPath("/plugins/linear"),
    keywords: ["plugins", "linear"],
    excerpt: "File a Linear issue automatically when Mushi classifies a bug report — create a Linear API key, install the plugin, and choose the team and filters.",
  },
  {
    title: "Microsoft Teams",
    path: docPath("/plugins/msteams"),
    keywords: ["plugins", "msteams", "microsoft", "teams"],
    excerpt: "Send Adaptive Cards to a Microsoft Teams channel when Mushi classifies a report or a fix lands — incoming webhook setup and severity filters.",
  },
  {
    title: "PagerDuty",
    path: docPath("/plugins/pagerduty"),
    keywords: ["plugins", "pagerduty"],
    excerpt: "Page your on-call rotation through PagerDuty when a P0 or P1 bug report lands in Mushi — Events API v2 integration key setup and filters.",
  },
  {
    title: "Rollbar",
    path: docPath("/plugins/rollbar"),
    keywords: ["plugins", "rollbar"],
    excerpt: "Mirror Mushi bug reports into Rollbar items and resolve them when fixes ship — access token, environment name, and dedup key mapping.",
  },
  {
    title: "Sentry",
    path: docPath("/plugins/sentry"),
    keywords: ["plugins", "sentry"],
    excerpt: "Two-way Sentry integration — Sentry errors flow into Mushi's queue, merging a Mushi fix resolves the Sentry issue, and critical reports mirror back.",
  },
  {
    title: "Slack app",
    path: docPath("/plugins/slack"),
    keywords: ["plugins", "slack", "app"],
    excerpt: "Triage Mushi bug reports from Slack — each classified report posts as a card with its root cause and buttons to dispatch a fix, resolve or dismiss.",
  },
  {
    title: "Zapier",
    path: docPath("/plugins/zapier"),
    keywords: ["plugins", "zapier"],
    excerpt: "Send every Mushi event to Zapier and on to thousands of apps such as Notion, Google Sheets and HubSpot — Catch Hook setup and event filters.",
  },
  {
    title: "Pricing — free tier, Pro, and self-host",
    path: docPath("/pricing"),
    keywords: ["pricing", "free", "tier", "pro", "self-host"],
    excerpt: "Mushi Mushi pricing — 50 AI bug diagnoses a month free, no card. Open-source Sentry alternative you can self-host for free, or upgrade for teams.",
  },
  {
    title: "Quickstart — fix your first bug in 60 seconds",
    path: docPath("/quickstart"),
    keywords: ["quickstart", "fix", "first", "bug", "60", "seconds", "choose", "stack"],
    excerpt: "Install Mushi with npx mushi-mushi, connect Cursor or Claude Code over MCP, and turn user bug reports into plain-English diagnoses with ready fixes.",
  },
  {
    title: "Android (Kotlin) quickstart",
    path: docPath("/quickstart/android"),
    keywords: ["quickstart", "android", "kotlin"],
    excerpt: "Try Mushi's native Kotlin SDK on Android — shake-to-report, a bottom-sheet widget and an offline queue. A preview built from source, not on Maven Central yet.",
  },
  {
    title: "Angular quickstart",
    path: docPath("/quickstart/angular"),
    keywords: ["quickstart", "angular"],
    excerpt: "Add Mushi to an Angular 17+ app — register the Mushi service and error handler as factory providers so uncaught errors and user bug reports reach your queue.",
  },
  {
    title: "Capacitor quickstart",
    path: docPath("/quickstart/capacitor"),
    keywords: ["quickstart", "capacitor"],
    excerpt: "Add Mushi to an Ionic or Capacitor app — install @mushi-mushi/capacitor, configure shake-to-report and screenshots, and file your first bug report.",
  },
  {
    title: "CLI ↔ console setup loop",
    path: docPath("/quickstart/cli-console-loop"),
    keywords: ["quickstart", "cli-console-loop", "cli", "console", "loop", "setup"],
    excerpt: "How npx mushi-mushi creates a project, mints an SDK key and installs the SDK through browser sign-in, and how to recover when the setup loop fails.",
  },
  {
    title: "Flutter quickstart",
    path: docPath("/quickstart/flutter"),
    keywords: ["quickstart", "flutter"],
    excerpt: "Add Mushi's Flutter SDK as a git dependency — shake-to-report, a Material bottom sheet and an offline queue for iOS and Android. Preview, not on pub.dev yet.",
  },
  {
    title: "Incident loop — bug to fix prompt",
    path: docPath("/quickstart/incident-loop"),
    keywords: ["quickstart", "incident-loop", "incident", "loop", "bug", "fix", "prompt"],
    excerpt: "Run npx mushi-mushi, ship, and turn your first user-reported bug into a plain-English diagnosis and a paste-ready fix for Cursor or Claude Code.",
  },
  {
    title: "iOS (Swift) quickstart",
    path: docPath("/quickstart/ios"),
    keywords: ["quickstart", "ios", "swift"],
    excerpt: "Add Mushi's native Swift SDK to an iOS app with Swift Package Manager — shake-to-report, offline queue and device context. Preview build, not on CocoaPods yet.",
  },
  {
    title: "MCP server for bug fixing in Cursor & Claude Code",
    path: docPath("/quickstart/mcp"),
    keywords: ["quickstart", "mcp", "server", "bug", "fixing", "cursor", "claude", "code"],
    excerpt: "Set up the Mushi MCP server with npx mushi-mushi setup — read bug reports, get fix context, and dispatch fixes from Cursor, Claude Code, or Codex.",
  },
  {
    title: "Mobile (overview)",
    path: docPath("/quickstart/mobile"),
    keywords: ["quickstart", "mobile", "overview"],
    excerpt: "Shake-to-report bug capture for mobile apps — React Native and Capacitor from npm with npx mushi-mushi, plus preview native SDKs for iOS, Android and Flutter.",
  },
  {
    title: "React quickstart",
    path: docPath("/quickstart/react"),
    keywords: ["quickstart", "react"],
    excerpt: "Add the Mushi React SDK in one command — npx mushi-mushi installs the bug-reporting widget, writes env vars, and files your first test report.",
  },
  {
    title: "React Native quickstart",
    path: docPath("/quickstart/react-native"),
    keywords: ["quickstart", "react-native", "react", "native"],
    excerpt: "Add shake-to-report bug capture to a React Native or Expo app with @mushi-mushi/react-native — install, mount the provider, and verify the first report.",
  },
  {
    title: "Svelte quickstart",
    path: docPath("/quickstart/svelte"),
    keywords: ["quickstart", "svelte"],
    excerpt: "Add Mushi bug reporting to a Svelte or SvelteKit app — install @mushi-mushi/svelte and call initMushi from hooks.client.ts or a root layout's onMount.",
  },
  {
    title: "Vue 3 quickstart",
    path: docPath("/quickstart/vue"),
    keywords: ["quickstart", "vue"],
    excerpt: "Add Mushi bug reporting to a Vue 3 app — install @mushi-mushi/vue and register MushiPlugin with your project ID and public API key in main.ts.",
  },
  {
    title: "Vanilla JS quickstart",
    path: docPath("/quickstart/web"),
    keywords: ["quickstart", "web", "vanilla", "js"],
    excerpt: "Add Mushi's browser SDK to any site without a framework — install @mushi-mushi/web, call Mushi.init, and file bug reports from your buttons or the widget.",
  },
  {
    title: "Roadmap",
    path: docPath("/roadmap"),
    keywords: ["roadmap"],
    excerpt: "Where Mushi Mushi is headed — upcoming SDK platforms, diagnosis speed targets, and console features, updated as work lands.",
  },
  {
    title: "SDK reference",
    path: docPath("/sdks"),
    keywords: ["sdks", "sdk", "reference", "index"],
    excerpt: "Bug-reporting SDKs for React, Vue, Svelte, Angular, React Native, Capacitor and Node, installed by npx mushi-mushi, plus preview iOS, Android and Flutter SDKs.",
  },
  {
    title: "@mushi-mushi/adapters",
    path: docPath("/sdks/adapters"),
    keywords: ["sdks", "adapters", "@mushi-mushi/adapters"],
    excerpt: "Turn Sentry, Datadog, Bugsnag and other monitoring webhooks into Mushi reports with @mushi-mushi/adapters, deduped against the same queue as user reports.",
  },
  {
    title: "Product analytics (track)",
    path: docPath("/sdks/analytics"),
    keywords: ["sdks", "analytics", "product", "track"],
    excerpt: "Mushi.track() reference — named events, consent, sampling and batching, useMushiTrack() for React, Users & Funnels, and the /v1/sdk/events wire format.",
  },
  {
    title: "dev.mushimushi:mushi-android (Android)",
    path: docPath("/sdks/android"),
    keywords: ["sdks", "android", "dev.mushimushi", "mushi-android"],
    excerpt: "API reference for Mushi's native Kotlin SDK — init, report, captureError, showWidget, breadcrumbs and the Sentry bridge. A preview built from source.",
  },
  {
    title: "@mushi-mushi/angular",
    path: docPath("/sdks/angular"),
    keywords: ["sdks", "angular", "@mushi-mushi/angular"],
    excerpt: "API reference for @mushi-mushi/angular — MushiService, MushiErrorHandler and the MUSHI_CONFIG token, wired with factory providers in an Angular 17+ app.",
  },
  {
    title: "In-SDK Ask assistant",
    path: docPath("/sdks/assistant"),
    keywords: ["sdks", "assistant", "in-sdk", "ask"],
    excerpt: "The Mushi widget's Ask tab answers end users' questions from the current page and your knowledge corpus, using your own LLM key, with every turn logged.",
  },
  {
    title: "@mushi-mushi/capacitor",
    path: docPath("/sdks/capacitor"),
    keywords: ["sdks", "capacitor", "@mushi-mushi/capacitor"],
    excerpt: "API reference for @mushi-mushi/capacitor — configure, report, listeners, setUser and widget options for Ionic and Capacitor apps on iOS, Android and web.",
  },
  {
    title: "Capacitor bottom dock",
    path: docPath("/sdks/capacitor-bottom-dock"),
    keywords: ["sdks", "capacitor-bottom-dock", "capacitor", "bottom", "dock"],
    excerpt: "Keep the Mushi bug-report button clear of tab bars and bottom docks in Capacitor apps with triggerInsetPreset, explicit insets, or widget.anchor.",
  },
  {
    title: "@mushi-mushi/cli",
    path: docPath("/sdks/cli"),
    keywords: ["sdks", "cli", "@mushi-mushi/cli"],
    excerpt: "Reference for @mushi-mushi/cli — log in, connect a project, run doctor, list reports, dispatch agent fixes and merge their pull requests from the terminal.",
  },
  {
    title: "@mushi-mushi/core",
    path: docPath("/sdks/core"),
    keywords: ["sdks", "core", "@mushi-mushi/core"],
    excerpt: "Reference for @mushi-mushi/core — the MushiConfig shape, widget options, PII scrubbing helpers and region resolution shared by every Mushi JavaScript SDK.",
  },
  {
    title: "eslint-plugin-mushi-mushi",
    path: docPath("/sdks/eslint-plugin"),
    keywords: ["sdks", "eslint-plugin", "eslint", "plugin", "eslint-plugin-mushi-mushi"],
    excerpt: "eslint-plugin-mushi-mushi flags empty event handlers and leftover mock data in production code — the no-dead-handler and no-mock-leak rules and preset.",
  },
  {
    title: "mushi_mushi (Flutter)",
    path: docPath("/sdks/flutter"),
    keywords: ["sdks", "flutter"],
    excerpt: "API reference for mushi_mushi, Mushi's Flutter SDK — configure, report, captureError, showWidget, screenshots and the offline queue. Preview, not on pub.dev.",
  },
  {
    title: "Framework wrappers (Vue / Svelte / Angular)",
    path: docPath("/sdks/framework-wrappers"),
    keywords: ["sdks", "framework-wrappers", "framework", "wrappers", "vue", "svelte", "angular"],
    excerpt: "How the Vue, Svelte and Angular Mushi packages wrap @mushi-mushi/web — how each one boots the SDK once, and where to find capture and widget options.",
  },
  {
    title: "@mushi-mushi/inventory-auth-runner",
    path: docPath("/sdks/inventory-auth-runner"),
    keywords: ["sdks", "inventory-auth-runner", "inventory", "auth", "runner", "@mushi-mushi/inventory-auth-runner"],
    excerpt: "@mushi-mushi/inventory-auth-runner logs in with Playwright from your inventory.yaml auth script so Mushi's crawler can reach pages behind a login.",
  },
  {
    title: "@mushi-mushi/inventory-schema",
    path: docPath("/sdks/inventory-schema"),
    keywords: ["sdks", "inventory-schema", "inventory", "schema", "@mushi-mushi/inventory-schema"],
    excerpt: "The Zod schema, JSON Schema and TypeScript types for inventory.yaml — the contract that Mushi's gates, crawler, ESLint plugin and CLI all read.",
  },
  {
    title: "MushiMushi (iOS)",
    path: docPath("/sdks/ios"),
    keywords: ["sdks", "ios", "mushimushi"],
    excerpt: "API reference for MushiMushi, Mushi's native Swift SDK — configure, report, captureError, breadcrumbs and PII scrubbing. Preview, via SwiftPM from master.",
  },
  {
    title: "mushi-mushi (launcher)",
    path: docPath("/sdks/launcher"),
    keywords: ["sdks", "launcher", "mushi-mushi"],
    excerpt: "npx mushi-mushi detects your framework, installs the matching @mushi-mushi SDK, writes your project ID and API key to .env.local, and prints the snippet.",
  },
  {
    title: "@mushi-mushi/mcp",
    path: docPath("/sdks/mcp"),
    keywords: ["sdks", "mcp", "@mushi-mushi/mcp"],
    excerpt: "Reference for @mushi-mushi/mcp, the Mushi MCP server for Cursor, Claude Code, VS Code and Windsurf — stdio and hosted HTTP transports, scopes and setup.",
  },
  {
    title: "@mushi-mushi/mcp-ci",
    path: docPath("/sdks/mcp-ci"),
    keywords: ["sdks", "mcp-ci", "mcp", "@mushi-mushi/mcp-ci"],
    excerpt: "@mushi-mushi/mcp-ci is Mushi's GitHub Action — run the five-gate composite check on pull requests, draft inventory entries, and bootstrap crawler auth.",
  },
  {
    title: "MCP tools reference",
    path: docPath("/sdks/mcp-tools"),
    keywords: ["sdks", "mcp-tools", "mcp", "tools", "reference"],
    excerpt: "Every tool, resource and prompt the Mushi MCP server exposes to Cursor, Claude Code and other editors, with its read or write scope, from the catalog.",
  },
  {
    title: "Next.js App Router + CSP",
    path: docPath("/sdks/nextjs-app-router-csp"),
    keywords: ["sdks", "nextjs-app-router-csp", "nextjs", "app", "router", "csp", "next.js"],
    excerpt: "Mount Mushi in a Next.js App Router client component and allow its endpoints in your Content-Security-Policy, with a copy-paste CSP allowlist.",
  },
  {
    title: "Next.js static export",
    path: docPath("/sdks/nextjs-static-export"),
    keywords: ["sdks", "nextjs-static-export", "nextjs", "static", "export", "next.js"],
    excerpt: "Use Mushi in a Next.js static export — keep the public env vars in NEXT_PUBLIC_* or set runtimeConfig to false, and initialise on the client only.",
  },
  {
    title: "@mushi-mushi/node",
    path: docPath("/sdks/node"),
    keywords: ["sdks", "node", "@mushi-mushi/node"],
    excerpt: "Report server errors from Node with @mushi-mushi/node — Express, Fastify and Hono error handlers that tag each report with route, request ID and user.",
  },
  {
    title: "@mushi-mushi/plugin-sdk",
    path: docPath("/sdks/plugin-sdk"),
    keywords: ["sdks", "plugin-sdk", "plugin", "sdk", "@mushi-mushi/plugin-sdk"],
    excerpt: "Build a Mushi plugin in TypeScript with @mushi-mushi/plugin-sdk — verify webhook signatures, dedupe deliveries and handle lifecycle events in Express.",
  },
  {
    title: "SDK presets",
    path: docPath("/sdks/presets"),
    keywords: ["sdks", "presets", "sdk"],
    excerpt: "Mushi SDK presets such as production-calm set sensible widget and capture defaults in one line, and any explicit Mushi.init option still wins.",
  },
  {
    title: "@mushi-mushi/react",
    path: docPath("/sdks/react"),
    keywords: ["sdks", "react", "@mushi-mushi/react"],
    excerpt: "Reference for @mushi-mushi/react — MushiProvider, the useMushi, useMushiSdk and useMushiReport hooks, identifying users, and the rewards hooks and badge.",
  },
  {
    title: "@mushi-mushi/react-native",
    path: docPath("/sdks/react-native"),
    keywords: ["sdks", "react-native", "react", "native", "@mushi-mushi/react-native"],
    excerpt: "Reference for @mushi-mushi/react-native — MushiProvider, hooks, shake-to-report, screenshots, identity and the offline queue for React Native and Expo.",
  },
  {
    title: "Sentry Replay coexistence",
    path: docPath("/sdks/sentry-replay-coexistence"),
    keywords: ["sdks", "sentry-replay-coexistence", "sentry", "replay", "coexistence"],
    excerpt: "Run Mushi next to Sentry Session Replay — initialise Sentry first so Mushi attaches the Sentry event and replay IDs to every bug report it sends.",
  },
  {
    title: "Agent skills",
    path: docPath("/sdks/skills"),
    keywords: ["sdks", "skills", "agent"],
    excerpt: "Install Mushi playbooks into Cursor and Claude Code, sync them into the console catalog, and attach skill chains to bug reports.",
  },
  {
    title: "@mushi-mushi/svelte",
    path: docPath("/sdks/svelte"),
    keywords: ["sdks", "svelte", "@mushi-mushi/svelte"],
    excerpt: "Reference for @mushi-mushi/svelte — initMushi, getMushi and the SvelteKit error hooks that forward client and server errors to your Mushi queue.",
  },
  {
    title: "@mushi-mushi/vue",
    path: docPath("/sdks/vue"),
    keywords: ["sdks", "vue", "@mushi-mushi/vue"],
    excerpt: "Reference for @mushi-mushi/vue — install MushiPlugin, use the useMushi and useMushiReport composables, identify users and submit reports in Vue 3.",
  },
  {
    title: "@mushi-mushi/wasm-classifier",
    path: docPath("/sdks/wasm-classifier"),
    keywords: ["sdks", "wasm-classifier", "wasm", "classifier", "@mushi-mushi/wasm-classifier"],
    excerpt: "@mushi-mushi/wasm-classifier runs a small on-device model in the browser to drop junk bug reports before they reach your LLM, cutting classification cost.",
  },
  {
    title: "@mushi-mushi/web",
    path: docPath("/sdks/web"),
    keywords: ["sdks", "web", "@mushi-mushi/web"],
    excerpt: "Reference for @mushi-mushi/web, the browser SDK — screenshots, console and network capture, the Shadow DOM widget, sampling, beforeSend and privacy.",
  },
  {
    title: "Security & compliance",
    path: docPath("/security"),
    keywords: ["security", "compliance"],
    excerpt: "How Mushi Mushi protects bug-report data — residency, your own keys and storage, retention sweeps, RLS coverage, prompt-injection defence and SOC 2.",
  },
  {
    title: "BYO storage",
    path: docPath("/security/byo-storage"),
    keywords: ["security", "byo-storage", "byo", "storage"],
    excerpt: "Keep Mushi screenshots and crash dumps in your own storage bucket instead of Mushi's — credentials in Vault, signed URLs, and the same console view.",
  },
  {
    title: "Bring-your-own-key",
    path: docPath("/security/byok"),
    keywords: ["security", "byok", "bring-your-own-key"],
    excerpt: "Use your own Anthropic or OpenAI API key for a Mushi project, so every classification, judge and fix run bills to your provider account.",
  },
  {
    title: "Data residency",
    path: docPath("/security/data-residency"),
    keywords: ["security", "data-residency", "data", "residency"],
    excerpt: "Where Mushi Cloud stores data today (Tokyo, ap-northeast-1), how the region picked at project creation works, and what the SDK does about regions.",
  },
  {
    title: "No client data leakage — what we promise and how we enforce it",
    path: docPath("/security/no-leakage-claim"),
    keywords: ["security", "no-leakage-claim", "leakage", "claim", "no", "client", "data", "we", "promise", "enforce"],
    excerpt: "Explicit enumeration of Mushi Mushi's privacy boundaries, the gaps we've closed, and the controls that keep client data isolated.",
  },
  {
    title: "Prompt-injection defence",
    path: docPath("/security/prompt-injection"),
    keywords: ["security", "prompt-injection", "prompt", "injection", "defence"],
    excerpt: "How Mushi defends its LLM pipeline against prompt injection hidden in user bug reports, and the OWASP LLM01 regression suite that runs on every CI push.",
  },
  {
    title: "SOC 2 readiness",
    path: docPath("/security/soc2"),
    keywords: ["security", "soc2", "soc", "readiness"],
    excerpt: "Mushi's SOC 2 Type 1 readiness module — automated evidence for access, retention and encryption controls, DSAR exports, and a quarterly evidence pack.",
  },
  {
    title: "Self-hosting",
    path: docPath("/self-hosting"),
    keywords: ["self-hosting", "self", "hosting"],
    excerpt: "Run the whole Mushi Mushi stack yourself with one command — Docker Compose, your own keys, AGPLv3 server, MIT SDKs, no usage limits.",
  },
  {
    title: "Admin SPA deploy",
    path: docPath("/self-hosting/admin-spa"),
    keywords: ["self-hosting", "self", "hosting", "admin-spa", "admin", "spa", "deploy"],
    excerpt: "Build and deploy the Mushi admin console yourself — a static Vite and React app that talks to your Supabase project, and the env vars it needs.",
  },
  {
    title: "Self-host in minutes (Docker Compose)",
    path: docPath("/self-hosting/docker-compose"),
    keywords: ["self-hosting", "self", "hosting", "docker-compose", "docker", "compose", "self-host", "minutes"],
    excerpt: "Self-host the whole Mushi stack with one Docker Compose file — Postgres, auth, storage, edge functions, the admin console and a Caddy reverse proxy.",
  },
  {
    title: "Edge Functions deploy",
    path: docPath("/self-hosting/edge-functions"),
    keywords: ["self-hosting", "self", "hosting", "edge-functions", "edge", "functions", "deploy"],
    excerpt: "Deploy Mushi's Supabase Edge Functions for a self-hosted install — the minimal ingest and classification set, the full list, and the secrets they need.",
  },
  {
    title: "Langfuse + Sentry",
    path: docPath("/self-hosting/observability"),
    keywords: ["self-hosting", "self", "hosting", "observability", "langfuse", "sentry"],
    excerpt: "Wire Langfuse LLM tracing and Sentry error tracking into a self-hosted Mushi server — the Edge Function secrets and what each trace records.",
  },
  {
    title: "Supabase setup",
    path: docPath("/self-hosting/supabase"),
    keywords: ["self-hosting", "self", "hosting", "supabase", "setup"],
    excerpt: "Set up a Supabase project for self-hosted Mushi — link the CLI, push every migration, and enable the Postgres extensions the server needs.",
  },
  {
    title: "Use cases & comparisons",
    path: docPath("/use-cases"),
    keywords: ["use-cases", "use", "cases", "comparisons"],
    excerpt: "Where Mushi Mushi fits — as an open-source Sentry alternative, a debugger for Cursor and Claude Code apps, and an MCP bug-fixing server for your editor.",
  },
  {
    title: "AI code bug fixing — report to merged fix",
    path: docPath("/use-cases/ai-code-bug-fixing"),
    keywords: ["use-cases", "use", "cases", "ai-code-bug-fixing", "code", "bug", "fixing", "ai", "report", "merged", "fix"],
    excerpt: "AI code bug fixing end to end — user reports become plain-English diagnoses, fix prompts, and optional draft PRs, with lessons that prevent repeats.",
  },
  {
    title: "Debug apps built with Claude Code",
    path: docPath("/use-cases/debug-claude-code-apps"),
    keywords: ["use-cases", "use", "cases", "debug-claude-code-apps", "debug", "claude", "code", "apps", "built"],
    excerpt: "How to debug an app Claude Code built — bug reports arrive as plain-English diagnoses your Claude Code agent reads and fixes over MCP, fix prompt included.",
  },
  {
    title: "Debug apps built with Cursor",
    path: docPath("/use-cases/debug-cursor-apps"),
    keywords: ["use-cases", "use", "cases", "debug-cursor-apps", "debug", "cursor", "apps", "built"],
    excerpt: "How to debug an app Cursor wrote for you — user bug reports become plain-English diagnoses and fix prompts your Cursor agent applies over MCP.",
  },
  {
    title: "Your Lovable app broke in production",
    path: docPath("/use-cases/lovable-app-broke-in-production"),
    keywords: ["use-cases", "use", "cases", "lovable-app-broke-in-production", "lovable", "app", "broke", "production"],
    excerpt: "What to do when a Lovable, Bolt, Cursor or Claude Code app breaks for a real user — reproduce it, read the first error, and ask the agent for the smallest fix.",
  },
  {
    title: "MCP server for bug fixing",
    path: docPath("/use-cases/mcp-bug-fixing-server"),
    keywords: ["use-cases", "use", "cases", "mcp-bug-fixing-server", "mcp", "bug", "fixing", "server"],
    excerpt: "What an MCP bug-fixing server is and how Mushi's works — Cursor, Claude Code, or Codex read live bug reports, pull fix context, and dispatch fixes.",
  },
  {
    title: "Sentry alternative for AI-built apps",
    path: docPath("/use-cases/sentry-alternative"),
    keywords: ["use-cases", "use", "cases", "sentry-alternative", "sentry", "alternative", "ai-built", "apps"],
    excerpt: "An open-source Sentry alternative for AI-built apps — plain-English bug diagnoses and ready fixes instead of raw stack traces. Works with or without Sentry.",
  },
]

export function searchMushiDocs(query: string, limit = 8): Array<DocIndexEntry & { score: number }> {
  const q = query.trim().toLowerCase()
  if (!q) {
    return MUSHI_DOCS_INDEX.slice(0, limit).map((e) => ({ ...e, score: 0 }))
  }
  const terms = q.split(/\s+/).filter(Boolean)
  const scored = MUSHI_DOCS_INDEX.map((entry) => {
    const title = entry.title.toLowerCase()
    const hay = (entry.title + ' ' + entry.keywords.join(' ') + ' ' + entry.excerpt).toLowerCase()
    let score = 0
    for (const term of terms) {
      if (title.includes(term)) score += 4
      if (entry.keywords.some((k) => k === term)) score += 4
      else if (entry.keywords.some((k) => k.includes(term))) score += 2
      if (hay.includes(term)) score += 1
    }
    // Every term matched somewhere → strong signal the page is about the query.
    if (terms.length > 1 && terms.every((t) => hay.includes(t))) score += 3
    // Shallow routes (quickstart, sdks) are the pages agents usually want first.
    if (score > 0 && entry.path.split('/').length <= BASE.split('/').length + 2) score += 1
    return { ...entry, score }
  })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  return scored.slice(0, limit)
}
