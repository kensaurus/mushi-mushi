// GENERATED — do not edit.
// Source: apps/docs/public/llms.txt + apps/docs/content/**/*.mdx
// Regenerate: node scripts/gen-mcp-docs-index.mjs   (CI: --check)
/* eslint-disable */

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

/** 201 pages, generated from llms.txt. */
export const MUSHI_DOCS_INDEX: DocIndexEntry[] = [
  {
    title: "Mushi Mushi — know why your AI-built app broke, with the fix ready",
    path: docPath("/"),
    keywords: ["know", "ai-built", "app", "broke", "fix", "ready"],
    excerpt: "Your AI shipped it. Mushi tells you why it broke — a plain-English diagnosis and a ready-to-apply fix, right in your editor. Standalone, open source, Sentry optional.",
  },
  {
    title: "Admin console",
    path: docPath("/admin"),
    keywords: ["admin", "console"],
    excerpt: "Skill playbooks · Rewards · Knowledge graph · Fix quality scores · Weekly insights · Fine-tuning · Live collaboration · MCP · Connect",
  },
  {
    title: "Activity",
    path: docPath("/admin/activity"),
    keywords: ["admin", "activity"],
    excerpt: "Activity is the per-project engagement dashboard. It reads SDK session telemetry (session start / heartbeat / end, page views, identity) and pairs it with report counts for the…",
  },
  {
    title: "Anomaly detection",
    path: docPath("/admin/anomalies"),
    keywords: ["admin", "anomalies", "anomaly", "detection"],
    excerpt: "The Anomaly detection page applies statistical detectors to time-series metrics you feed in. When a metric behaves unexpectedly, it surfaces as an anomaly — optionally auto-filing…",
  },
  {
    title: "Anti-gaming",
    path: docPath("/admin/anti-gaming"),
    keywords: ["admin", "anti-gaming", "anti", "gaming"],
    excerpt: "The Anti-gaming page surfaces reporters whose submission patterns look anomalous — devices sending many near-identical reports, accounts farming reward points, or sessions that…",
  },
  {
    title: "Audit log",
    path: docPath("/admin/audit"),
    keywords: ["admin", "audit", "log"],
    excerpt: "The audit log is an immutable record of every action taken in the system — by humans, agents, and automated pipelines. Every entry is timestamped, attributed, and expandable to…",
  },
  {
    title: "Billing",
    path: docPath("/admin/billing"),
    keywords: ["admin", "billing"],
    excerpt: "Everything you need to manage your subscription is on this page: live usage with forecast and projected cost, plan comparison, invoices, spend caps, and in-console support.",
  },
  {
    title: "CLI device auth",
    path: docPath("/admin/cli-auth"),
    keywords: ["admin", "cli-auth", "cli", "auth", "device"],
    excerpt: "RFC 8628 device authorization grant for the CLI:",
  },
  {
    title: "Code health",
    path: docPath("/admin/code-health"),
    keywords: ["admin", "code-health", "code", "health"],
    excerpt: "This page reads only — it never triggers a scan. Data arrives via POST /v1/ingest/metrics from your repo's CI workflow.",
  },
  {
    title: "Compliance",
    path: docPath("/admin/compliance"),
    keywords: ["admin", "compliance"],
    excerpt: "The Compliance page handles both of these without leaving the console — SOC 2 evidence snapshots, data-residency pinning, retention policies, and DSAR management.",
  },
  {
    title: "Connect & Update",
    path: docPath("/admin/connect"),
    keywords: ["admin", "connect", "update"],
    excerpt: "The page opens with ConnectStudio — pick your AI client, then choose a lane (MCP / CLI / Skills). Work through the sections below top-to-bottom. Connecting GitHub enables the…",
  },
  {
    title: "Content quality",
    path: docPath("/admin/content"),
    keywords: ["admin", "content", "quality"],
    excerpt: "The Content Quality Debug Station lists assets that need review:",
  },
  {
    title: "Cost & usage",
    path: docPath("/admin/cost"),
    keywords: ["admin", "cost", "usage"],
    excerpt: "The Cost page shows LLM token consumption and estimated spend across all AI pipelines for the selected project and time range.",
  },
  {
    title: "Dashboard",
    path: docPath("/admin/dashboard"),
    keywords: ["admin", "dashboard"],
    excerpt: "The dashboard answers those questions without clicking into any sub-page. It's your morning starting point — a live snapshot of what users reported, what's getting fixed, and what…",
  },
  {
    title: "Docs bridge",
    path: docPath("/admin/docs-bridge"),
    keywords: ["admin", "docs-bridge", "bridge"],
    excerpt: "The docs bridge is a silent authentication relay used by the documentation site (kensaur.us/mushi-mushi/docs) to access Mushi APIs on behalf of a logged-in user — for example, to…",
  },
  {
    title: "Drift scanner",
    path: docPath("/admin/drift"),
    keywords: ["admin", "drift", "scanner"],
    excerpt: "The drift scanner compares your live app against the contract snapshot the SDK took when it last crawled your routes and components. Anything that's missing, changed, or new shows…",
  },
  {
    title: "Experiments",
    path: docPath("/admin/experiments"),
    keywords: ["admin", "experiments"],
    excerpt: "The Experiments page lets you define A/B tests, launch them, collect results, and run statistical analysis (CUPED variance reduction + mSPRT sequential testing) to determine a…",
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
    excerpt: "Community-driven board of feature-category support tickets:",
  },
  {
    title: "Feedback hub",
    path: docPath("/admin/feedback"),
    keywords: ["admin", "feedback", "hub"],
    excerpt: "Tabs: Overview · Active · Shipped · All. The page shows a status banner, KPI snapshot strip, and support ticket list. Unread operator replies surface as chips; open a ticket for…",
  },
  {
    title: "Fine-tuning",
    path: docPath("/admin/fine-tuning"),
    keywords: ["admin", "fine-tuning", "fine", "tuning"],
    excerpt: "The Fine-Tuning page guides you through exporting your project's best-scored classifications, training a fine-tuned variant, validating it against an offline benchmark, and…",
  },
  {
    title: "Fix drafts & PRs",
    path: docPath("/admin/fixes"),
    keywords: ["admin", "fixes", "fix", "drafts", "prs"],
    excerpt: "The Fixes page shows every draft pull request Mushi opened from a real bug — from the moment a fix run starts to when a PR is ready to review (or the run fails). Multi-repo…",
  },
  {
    title: "Full-stack audit",
    path: docPath("/admin/fullstack-audit"),
    keywords: ["admin", "fullstack-audit", "fullstack", "audit", "full-stack"],
    excerpt: "One Run audit button fans out to POST /v1/admin/projects/:id/audit and returns a severity-ranked scorecard in ~10 seconds.",
  },
  {
    title: "Knowledge graph",
    path: docPath("/admin/graph"),
    keywords: ["admin", "graph", "knowledge"],
    excerpt: "The Graph page renders your project's bug graph as an interactive, force-directed layout. It's the fastest way to see which components are on fire and which bugs are clustered…",
  },
  {
    title: "Integration health",
    path: docPath("/admin/health"),
    keywords: ["admin", "health", "integration"],
    excerpt: "The health page is your observatory for everything that runs in the background: LLM pipelines, cron jobs, and live provider connectivity. Use it to catch degradation before it…",
  },
  {
    title: "Action inbox",
    path: docPath("/admin/inbox"),
    keywords: ["admin", "inbox", "action"],
    excerpt: "The Inbox is your to-do list across the whole loop — every action that still needs you, in one prioritised view. Think of it as Monday-morning standup prep, auto-generated.",
  },
  {
    title: "Integrations",
    path: docPath("/admin/integrations"),
    keywords: ["admin", "integrations"],
    excerpt: "The Integrations page wires Mushi to the tools your team already uses: Sentry and Langfuse for context, GitHub for code, and Jira / Linear / PagerDuty for routing.",
  },
  {
    title: "Intelligence reports",
    path: docPath("/admin/intelligence"),
    keywords: ["admin", "intelligence", "reports"],
    excerpt: "The Intelligence page generates and delivers a weekly bug-intelligence digest per project. Think of it as the standup your bug tracker never gave you — written in plain English…",
  },
  {
    title: "User stories · Inventory",
    path: docPath("/admin/inventory"),
    keywords: ["admin", "inventory", "user", "stories"],
    excerpt: "The User stories surface (sidebar → User stories) is the v2 positive side of the loop. Where Reports / Graph / Fixes catch what your users felt break, the inventory describes what…",
  },
  {
    title: "Iterate",
    path: docPath("/admin/iterate"),
    keywords: ["admin", "iterate"],
    excerpt: "The Iterate page runs Plan → Do → Check → Act scoring loops autonomously. The agent crawls a URL, generates a quality critique across multiple dimensions (UX, performance…",
  },
  {
    title: "Judge dashboard",
    path: docPath("/admin/judge"),
    keywords: ["admin", "judge", "dashboard"],
    excerpt: "The Judge page shows how well Mushi's plain-English reads match reality over time. If classification quality is slipping — or a new prompt is ready to promote — you'll see it here…",
  },
  {
    title: "Lessons",
    path: docPath("/admin/lessons"),
    keywords: ["admin", "lessons"],
    excerpt: "A lesson is a structured coding rule extracted from a cluster of similar bug reports. Once promoted, it's injected into the LLM's context before every fix-worker run and every PR…",
  },
  {
    title: "Plugin marketplace",
    path: docPath("/admin/marketplace"),
    keywords: ["admin", "marketplace", "plugin"],
    excerpt: "The marketplace lets you install outbound plugins — PagerDuty, Linear, Zapier, and others — that receive webhook events from Mushi when reports are classified, fixes are deployed…",
  },
  {
    title: "MCP",
    path: docPath("/admin/mcp"),
    keywords: ["admin", "mcp"],
    excerpt: "Wire Mushi into Cursor, Claude Code, Windsurf, or any MCP client. Once connected, your agent can read reports, pull fix context, and optionally dispatch fixes — without leaving…",
  },
  {
    title: "MCP OAuth consent",
    path: docPath("/admin/mcp-auth"),
    keywords: ["admin", "mcp-auth", "mcp", "auth", "oauth", "consent"],
    excerpt: "OAuth consent for MCP clients (MCP auth spec):",
  },
  {
    title: "Notifications",
    path: docPath("/admin/notifications"),
    keywords: ["admin", "notifications"],
    excerpt: "The Notifications page shows the outbound notification history for this project — every alert Mushi sent to reporters and team members. Use it to debug delivery problems or audit…",
  },
  {
    title: "Onboarding",
    path: docPath("/admin/onboarding"),
    keywords: ["admin", "onboarding"],
    excerpt: "The onboarding wizard is the fastest path from signup to a live report in your queue. Work through the steps in order — each one opens the next.",
  },
  {
    title: "Overview (portfolio)",
    path: docPath("/admin/overview"),
    keywords: ["admin", "overview", "portfolio"],
    excerpt: "Overview is the portfolio dashboard for the active organization. Each card is one connected project — sessions, users, open reports, and a DAU sparkline — with footer links that…",
  },
  {
    title: "Projects",
    path: docPath("/admin/projects"),
    keywords: ["admin", "projects"],
    excerpt: "This page handles the full project lifecycle: create, configure, monitor, and (if needed) delete.",
  },
  {
    title: "Prompt lab",
    path: docPath("/admin/prompt-lab"),
    keywords: ["admin", "prompt-lab", "prompt", "lab"],
    excerpt: "The Prompt lab is where you iterate on the LLM prompts that power every Mushi pipeline. You never need to redeploy an edge function — change a prompt here and it takes effect…",
  },
  {
    title: "QA Coverage",
    path: docPath("/admin/qa-coverage"),
    keywords: ["admin", "qa-coverage", "coverage", "qa"],
    excerpt: "QA Coverage lets you describe user flows in plain English or paste Playwright scripts, run them on a schedule, and get screenshots plus failure evidence when something breaks.",
  },
  {
    title: "Natural-language query",
    path: docPath("/admin/query"),
    keywords: ["admin", "query", "natural-language"],
    excerpt: "The Query page lets you ask questions about your project's data in plain English. Type a question, get SQL, get a chart — no SQL knowledge required.",
  },
  {
    title: "Processing queue",
    path: docPath("/admin/queue"),
    keywords: ["admin", "queue", "processing"],
    excerpt: "The Processing queue is the operational view of every item flowing through Mushi's ingest and fix pipelines. Use it to monitor throughput, identify failures, retry stuck items…",
  },
  {
    title: "Real-time collaboration",
    path: docPath("/admin/realtime"),
    keywords: ["admin", "realtime", "real-time", "collaboration"],
    excerpt: "Reports are collaborative documents. Every report detail page shows who else is looking at it right now, and all comments stream in without a refresh — so you can review bugs…",
  },
  {
    title: "Releases",
    path: docPath("/admin/releases"),
    keywords: ["admin", "releases"],
    excerpt: "The Releases page generates AI-drafted changelogs for each version of your app, attributed to the reporters whose bug reports drove each fix.",
  },
  {
    title: "Repo graph",
    path: docPath("/admin/repo"),
    keywords: ["admin", "repo", "graph"],
    excerpt: "The Repo page shows the live state of every fix branch in your connected GitHub repository — which ones have open PRs, which are passing or failing CI, and what the fix-worker did…",
  },
  {
    title: "Reports & triage",
    path: docPath("/admin/reports"),
    keywords: ["admin", "reports", "triage"],
    excerpt: "The Reports list is your inbox — every user report, filterable by status, severity, category, component, and free text. A Recommended action card at the top tells you what needs…",
  },
  {
    title: "Research",
    path: docPath("/admin/research"),
    keywords: ["admin", "research"],
    excerpt: "The Research page is a Firecrawl-powered web search scoped to your tech stack. Ask questions in plain English and get summarised answers with source links, drawn from up-to-date…",
  },
  {
    title: "Rewards program",
    path: docPath("/admin/rewards"),
    keywords: ["admin", "rewards", "program"],
    excerpt: "The Rewards program turns passive bug reporters into engaged contributors. Every activity your users take in your app — navigating screens, submitting reports, leaving comments —…",
  },
  {
    title: "SDK health",
    path: docPath("/admin/sdk-health"),
    keywords: ["admin", "sdk-health", "sdk", "health"],
    excerpt: "Every project page surfaces a SDK health card with the live heartbeat of every SDK runtime that's reported in the last 24 h. It's the surface that catches \"I installed the SDK two…",
  },
  {
    title: "Settings",
    path: docPath("/admin/settings"),
    keywords: ["admin", "settings"],
    excerpt: "The tab you pick is saved in the URL (?tab=).",
  },
  {
    title: "Setup Copilot",
    path: docPath("/admin/setup-copilot"),
    keywords: ["admin", "setup-copilot", "setup", "copilot"],
    excerpt: "Guided verification panel for the active project:",
  },
  {
    title: "Skill Pipelines",
    path: docPath("/admin/skill-pipelines"),
    keywords: ["admin", "skill-pipelines", "skill", "pipelines"],
    excerpt: "Skill Pipelines integrate the cursor-kenji / skills.sh agent-skill ecosystem directly into Mushi bug review. When a bug report is classified, Mushi recommends the most relevant…",
  },
  {
    title: "SSO",
    path: docPath("/admin/sso"),
    keywords: ["admin", "sso"],
    excerpt: "The SSO page lets you register SAML 2.0 or OIDC identity providers for your organisation, so teammates can log in with your company's IdP instead of email + password.",
  },
  {
    title: "Storage",
    path: docPath("/admin/storage"),
    keywords: ["admin", "storage"],
    excerpt: "The Storage page configures where Mushi writes report attachments, session recordings, and evidence artifacts. By default, Mushi uses managed Supabase storage. You can switch to…",
  },
  {
    title: "Teams and Members",
    path: docPath("/admin/teams"),
    keywords: ["admin", "teams", "members"],
    excerpt: "Teams are modeled as organizations. An organization owns projects, billing, invitations, and the member roster. Every project keeps its existing projectid, but access is granted…",
  },
  {
    title: "Users",
    path: docPath("/admin/users"),
    keywords: ["admin", "users"],
    excerpt: "The Users page is a super-admin directory of every account that has signed up for Mushi. It shows MRR, churn, plan distribution, and per-user detail. It is only accessible to…",
  },
  {
    title: "Voice intake",
    path: docPath("/admin/voice"),
    keywords: ["admin", "voice", "intake"],
    excerpt: "Voice intake turns a spoken note into a report, and optionally into a dispatched draft-PR fix. Everything passes through one gate: you always see the verbatim transcript before…",
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
    title: "60 seconds from",
    path: docPath("/blog/auto-fix-loop"),
    keywords: ["blog", "auto-fix-loop", "auto", "fix", "loop", "60", "seconds"],
    excerpt: "A walkthrough of how Mushi Mushi turns a one-sentence user complaint into a classified, deduped, AI-judged draft PR — and why we kept the human in the loop the whole way.",
  },
  {
    title: "Launch Week 1 — five features, five days",
    path: docPath("/blog/launch-week-1"),
    keywords: ["blog", "launch-week-1", "launch", "week", "five", "features", "days"],
    excerpt: "Everything Mushi Mushi shipped in Launch Week 1 — one feature a day, from bug-report capture to editor-ready fixes, with demos and setup commands.",
  },
  {
    title: "I shipped a bug tool for 5 months and got 9 signups. Here",
    path: docPath("/blog/nine-signups-what-the-data-said"),
    keywords: ["blog", "nine-signups-what-the-data-said", "nine", "signups", "data", "said", "shipped", "bug", "tool", "months", "got", "here"],
    excerpt: "Five months after going public, Mushi Mushi had 30 npm packages, an MCP server in every registry, and nine signups. This is what the database, GitHub and the deploy config said…",
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
    keywords: ["compare"],
    excerpt: "Honest, dated comparisons of Mushi Mushi with Sentry, Jam and PostHog session replay, plus a Sentry-alternatives table for solo founders. Every number links to the page it was…",
  },
  {
    title: "Jam vs Mushi Mushi",
    path: docPath("/compare/jam-vs-mushi"),
    keywords: ["compare", "jam-vs-mushi", "jam"],
    excerpt: "Jam.dev vs Mushi Mushi in 2026 — a teammate recording a bug with the Jam extension versus an end user reporting from inside your app, what each hands to Cursor over MCP, and the…",
  },
  {
    title: "PostHog session replay vs Mushi Mushi",
    path: docPath("/compare/posthog-session-replay-vs-mushi"),
    keywords: ["compare", "posthog-session-replay-vs-mushi", "posthog", "session", "replay"],
    excerpt: "PostHog session replay and error tracking vs Mushi Mushi in 2026 — every session recorded versus the one where a user said it was broken, the free tiers, and why most teams run…",
  },
  {
    title: "Sentry alternatives for solo founders",
    path: docPath("/compare/sentry-alternatives-for-solo-founders"),
    keywords: ["compare", "sentry-alternatives-for-solo-founders", "sentry", "alternatives", "solo", "founders"],
    excerpt: "Sentry alternatives for solo founders in 2026 — Sentry, Bugsnag, Rollbar, highlight.io, PostHog and Mushi Mushi compared on free-tier caps, self-hosting, AI diagnosis and fixes…",
  },
  {
    title: "Sentry vs Mushi Mushi",
    path: docPath("/compare/sentry-vs-mushi"),
    keywords: ["compare", "sentry-vs-mushi", "sentry"],
    excerpt: "Sentry vs Mushi Mushi in 2026 — what each captures, the Sentry Developer free tier and Seer pricing next to Mushi's free 50 diagnoses a month, self-hosting, and how the two run…",
  },
  {
    title: "Concepts",
    path: docPath("/concepts"),
    keywords: ["concepts"],
    excerpt: "The loop in plain terms:",
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
    excerpt: "Bug-report platforms attract two failure modes:",
  },
  {
    title: "Architecture",
    path: docPath("/concepts/architecture"),
    keywords: ["concepts", "architecture"],
    excerpt: "The whole system is intentionally boring at the seams: a Hono gateway in front of Supabase, 51 specialised edge functions behind it, and three data substrates (relational + vector…",
  },
  {
    title: "Mushi Bounties — crowd-testing marketplace",
    path: docPath("/concepts/bounty-marketplace"),
    keywords: ["concepts", "bounty-marketplace", "bounty", "marketplace", "bounties", "crowd-testing"],
    excerpt: "Mushi Bounties is the crowd-testing marketplace built into the evolution loop. Developers publish their app or website to a public listing. Testers — real humans who are not on…",
  },
  {
    title: "How Mushi reads a bug report",
    path: docPath("/concepts/classification"),
    keywords: ["concepts", "classification", "reads", "bug", "report"],
    excerpt: "When a user submits a report, Mushi turns raw text and screenshots into a plain-English summary — severity, category, and what to try next — before anything hits your editor.",
  },
  {
    title: "Closed-loop evolution — the thesis",
    path: docPath("/concepts/closed-loop"),
    keywords: ["concepts", "closed-loop", "closed", "loop", "evolution", "thesis"],
    excerpt: "The vibe-coding era — AI-assisted development where you build and ship in hours — solved the creation bottleneck. The new bottleneck is selection: out of everything you could fix…",
  },
  {
    title: "Project ID & API keys",
    path: docPath("/concepts/credentials"),
    keywords: ["concepts", "credentials", "project", "id", "api", "keys"],
    excerpt: "Every SDK, CLI, and MCP call needs a project ID plus an API key. Both appear after you create a project on Setup → Verify (API key) or Projects (Project ID chip) — not under…",
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
    excerpt: "A walkthrough of the five stages that turn a user-felt bug into a merged fix and a lesson rule — the feedback loop that makes your software improve without Jira, QA teams, or PM…",
  },
  {
    title: "Fix drafts & PRs",
    path: docPath("/concepts/fix-orchestrator"),
    keywords: ["concepts", "fix-orchestrator", "fix", "orchestrator", "drafts", "prs"],
    excerpt: "When you click Dispatch fix in the admin console, Mushi opens a draft pull request on your repo — with a rationale, screenshot diff, and CI status you can review before merge.",
  },
  {
    title: "Inventory and gates (v2)",
    path: docPath("/concepts/inventory-and-gates"),
    keywords: ["concepts", "inventory-and-gates", "inventory", "gates", "v2"],
    excerpt: "Mushi v1 was the negative side of the loop: catch what your users felt break, classify it, dedupe it, optionally draft a fix. v2 adds the positive side: a declarative…",
  },
  {
    title: "Judge & self-improvement",
    path: docPath("/concepts/judge-loop"),
    keywords: ["concepts", "judge-loop", "judge", "loop", "self-improvement"],
    excerpt: "Mushi doesn't ship a static prompt. The classifier improves continuously through four interlocking loops — a nightly judge, prompt A/B testing, fine-tune export, and drift…",
  },
  {
    title: "Knowledge graph",
    path: docPath("/concepts/knowledge-graph"),
    keywords: ["concepts", "knowledge-graph", "knowledge", "graph"],
    excerpt: "Mushi maintains a per-project knowledge graph of reports, components, fixes, and the developers who touched them.",
  },
  {
    title: "Multi-repo coordinated fixes",
    path: docPath("/concepts/multi-repo-fixes"),
    keywords: ["concepts", "multi-repo-fixes", "multi", "repo", "fixes", "multi-repo", "coordinated"],
    excerpt: "A bug like \"checkout returns 400 with 'invalid currency'\" often spans two repos: the FE sends a malformed shape, the BE accepts a wider range than it should. Mushi's…",
  },
  {
    title: "Open source & licensing",
    path: docPath("/concepts/open-source"),
    keywords: ["concepts", "open-source", "open", "source", "licensing"],
    excerpt: "Mushi is open by default. The cloud product at kensaur.us/mushi-mushi/ runs the exact same code in this repository — there is no closed-source \"enterprise\" fork. What you…",
  },
  {
    title: "Connecting your orchestrator (MCP / A2A / REST / AG-UI)",
    path: docPath("/concepts/orchestrator-interop"),
    keywords: ["concepts", "orchestrator-interop", "orchestrator", "interop", "connecting", "mcp", "a2a", "rest", "ag-ui"],
    excerpt: "Mushi exposes four inbound surfaces and one outbound channel so any modern agent orchestrator — Cursor, Claude Code / Claude Desktop / Claude Agent SDK, OpenAI Agents SDK, ChatGPT…",
  },
  {
    title: "Rewards & contributor identity",
    path: docPath("/concepts/rewards"),
    keywords: ["concepts", "rewards", "contributor", "identity"],
    excerpt: "Reporters earn points when they submit and when triage completes. Points climb a project-defined tier ladder and can grant host-app perks (roles, credits) via signed webhooks — so…",
  },
  {
    title: "Runtime config",
    path: docPath("/concepts/runtime-config"),
    keywords: ["concepts", "runtime-config", "runtime", "config"],
    excerpt: "Most apps need no extra wiring. With runtimeConfig: 'auto' (the default), the SDK fetches GET /v1/sdk/config after init and merges console-side settings over your host config — so…",
  },
  {
    title: "Where the report button lives",
    path: docPath("/concepts/trigger-modes"),
    keywords: ["concepts", "trigger-modes", "trigger", "modes", "where", "report", "button", "lives"],
    excerpt: "Mushi ships a default bug-report launcher, but you decide where it appears — corner stamp, edge tab, help menu, or your own custom button.",
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
    excerpt: "How Mushi Mushi launches now — one public post per release (Show HN, then Product Hunt, then the growth loop), the gate each release must pass first, and what we publish…",
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
    excerpt: "The agreement for using Mushi Cloud, the admin console, the SDKs, and the Mushi Bounties tester marketplace — plans, limits, AI-output disclaimer, licenses, and liability.",
  },
  {
    title: "Migration guides",
    path: docPath("/migrations"),
    keywords: ["migrations", "migration", "guides"],
    excerpt: "Long-form playbooks for moving an existing app onto Mushi Mushi — or between Mushi-supported runtimes — without losing your project, your API key, or your reports inbox. Every…",
  },
  {
    title: "BugHerd → Mushi",
    path: docPath("/migrations/bugherd-to-mushi"),
    keywords: ["migrations", "bugherd-to-mushi", "bugherd"],
    excerpt: "BugHerd's signature feature is pixel-pin annotations — clients click on a part of a web page to attach a comment to that exact element. Mushi provides similar element-level…",
  },
  {
    title: "Migration: Capacitor → React Native",
    path: docPath("/migrations/capacitor-to-react-native"),
    keywords: ["migrations", "capacitor-to-react-native", "capacitor", "react", "native", "migration"],
    excerpt: "A complete porting plan for Ionic / Capacitor apps that want to move to React Native — with two end-to-end CI/CD options (Expo + EAS Build for the easy paid path, and React Native…",
  },
  {
    title: "Cordova → Capacitor",
    path: docPath("/migrations/cordova-to-capacitor"),
    keywords: ["migrations", "cordova-to-capacitor", "cordova", "capacitor"],
    excerpt: "Capacitor is the modern successor to Cordova from the same Ionic team. This guide migrates an existing Cordova app to Capacitor in place — same web codebase, new native shell —…",
  },
  {
    title: "Cordova → React Native",
    path: docPath("/migrations/cordova-to-react-native"),
    keywords: ["migrations", "cordova-to-react-native", "cordova", "react", "native"],
    excerpt: "A two-hop migration: stabilise on Capacitor first, then port screen-by-screen to React Native. This is the safest path if your Cordova app is non-trivial, because it lets you ship…",
  },
  {
    title: "Create React App → Vite",
    path: docPath("/migrations/cra-to-vite"),
    keywords: ["migrations", "cra-to-vite", "cra", "vite", "create", "react", "app"],
    excerpt: "create-react-app has been unmaintained since 2023 and the React team removed it from the official \"Start a New React Project\" page. Vite is the modern equivalent — faster dev…",
  },
  {
    title: "Instabug (Luciq) → Mushi",
    path: docPath("/migrations/instabug-to-mushi"),
    keywords: ["migrations", "instabug-to-mushi", "instabug", "luciq"],
    excerpt: "This is a low-risk swap because both products solve the same shape of problem (in-app bug capture) and use very similar config. Most apps land the cutover in an afternoon…",
  },
  {
    title: "LogRocket Feedback → Mushi",
    path: docPath("/migrations/logrocket-feedback-to-mushi"),
    keywords: ["migrations", "logrocket-feedback-to-mushi", "logrocket", "feedback"],
    excerpt: "LogRocket bundles session replay and bug feedback in one SDK. This guide moves the feedback widget to Mushi while you keep LogRocket for session replay (or migrate replay…",
  },
  {
    title: "@mushi-mushi/* upgrades",
    path: docPath("/migrations/mushi-sdk-upgrade"),
    keywords: ["migrations", "mushi-sdk-upgrade", "sdk", "upgrade", "@mushi-mushi", "upgrades"],
    excerpt: "We expect upgrades within the documented public API to not break:",
  },
  {
    title: "Native iOS / Android → Hybrid",
    path: docPath("/migrations/native-to-hybrid"),
    keywords: ["migrations", "native-to-hybrid", "native", "hybrid", "ios", "android"],
    excerpt: "When (and how) to wrap an existing pure-native iOS / Android app with Capacitor or React Native, keeping the platform Mushi SDKs in place.",
  },
  {
    title: "Next.js Pages → App Router",
    path: docPath("/migrations/nextjs-pages-to-app-router"),
    keywords: ["migrations", "nextjs-pages-to-app-router", "nextjs", "pages", "app", "router", "next.js"],
    excerpt: "Move a Next.js Pages-Router app to the App Router incrementally. The two routers can coexist (the App Router takes precedence for matching routes), so you don't need a flag day.",
  },
  {
    title: "Pendo Feedback → Mushi",
    path: docPath("/migrations/pendo-feedback-to-mushi"),
    keywords: ["migrations", "pendo-feedback-to-mushi", "pendo", "feedback"],
    excerpt: "Pendo bundles product analytics, in-app guides, NPS surveys, and a feedback module in one suite. This guide swaps the feedback module to Mushi while you keep Pendo for everything…",
  },
  {
    title: "React Native CLI ↔ Expo",
    path: docPath("/migrations/react-native-cli-to-expo"),
    keywords: ["migrations", "react-native-cli-to-expo", "react", "native", "cli", "expo"],
    excerpt: "Both directions covered. Pick one based on what you need:",
  },
  {
    title: "Sentry + Mushi (enrich or standalone)",
    path: docPath("/migrations/sentry-to-mushi"),
    keywords: ["migrations", "sentry-to-mushi", "sentry", "enrich", "standalone"],
    excerpt: "Install Mushi alongside Sentry. Neither SDK interferes with the other — Mushi's widget is Shadow-DOM isolated and captures on user trigger only.",
  },
  {
    title: "Shake → Mushi",
    path: docPath("/migrations/shake-to-mushi"),
    keywords: ["migrations", "shake-to-mushi", "shake"],
    excerpt: "Shake (shakebugs.com) is a closed-source bug reporting SDK with strong shake-to-report ergonomics. This guide swaps it for Mushi while preserving the same trigger UX.",
  },
  {
    title: "SPA → SSR (Next.js / Nuxt / SvelteKit)",
    path: docPath("/migrations/spa-to-ssr"),
    keywords: ["migrations", "spa-to-ssr", "spa", "ssr", "next.js", "nuxt", "sveltekit"],
    excerpt: "Move a Vite SPA (React, Vue, or Svelte) onto a server-rendered framework (Next.js, Nuxt, or SvelteKit respectively) for SEO, faster TTFB, and real route-level data loading.",
  },
  {
    title: "Vue 2 → Vue 3",
    path: docPath("/migrations/vue-2-to-vue-3"),
    keywords: ["migrations", "vue-2-to-vue-3", "vue"],
    excerpt: "Vue 2 reached end-of-life on 2023-12-31. Most apps have already migrated; this guide covers the holdouts and the Mushi-specific pieces.",
  },
  {
    title: "Operating (maintainers)",
    path: docPath("/operating"),
    keywords: ["operating", "maintainers"],
    excerpt: "This section is for maintainers running Mushi Cloud or shipping the open-source SDK packages — not for app developers integrating the SDK. If you are integrating Mushi into your…",
  },
  {
    title: "Deployment & releases",
    path: docPath("/operating/deployment"),
    keywords: ["operating", "deployment", "releases"],
    excerpt: "A public summary of how Mushi ships. The full maintainer runbook lives in the repo at docs/DEPLOYMENT.md.",
  },
  {
    title: "Status & Uptime",
    path: docPath("/operating/status"),
    keywords: ["operating", "status", "uptime"],
    excerpt: "Mushi Cloud is operated on a reasonable-efforts basis for the Free and Indie tiers. Pro subscribers receive priority incident response. Enterprise SLAs (99.9 % monthly uptime with…",
  },
  {
    title: "Plugin marketplace",
    path: docPath("/plugins"),
    keywords: ["plugins", "plugin", "marketplace"],
    excerpt: "Mushi events flow out as HMAC-signed JSON webhooks with Standard Webhooks headers (webhook-id / webhook-timestamp / webhook-signature: v1,…) to any tool you wire up. The…",
  },
  {
    title: "Bugsnag",
    path: docPath("/plugins/bugsnag"),
    keywords: ["plugins", "bugsnag"],
    excerpt: "Mirrors Mushi reports into Bugsnag projects and closes Bugsnag errors when the fix PR merges.",
  },
  {
    title: "Building a plugin",
    path: docPath("/plugins/building"),
    keywords: ["plugins", "building", "plugin"],
    excerpt: "A Mushi plugin is an HTTP endpoint that receives HMAC-signed webhook events and does something useful with them. The @mushi-mushi/plugin-sdk gives you typed event helpers and a…",
  },
  {
    title: "Crashlytics",
    path: docPath("/plugins/crashlytics"),
    keywords: ["plugins", "crashlytics"],
    excerpt: "Pushes Mushi mobile reports into Firebase Crashlytics issues and closes them when fixes merge.",
  },
  {
    title: "Cursor Cloud Agent",
    path: docPath("/plugins/cursor-cloud"),
    keywords: ["plugins", "cursor-cloud", "cursor", "cloud", "agent"],
    excerpt: "Automatically dispatches a Cursor Cloud Agent run when a qualifying Mushi event fires. The agent investigates the issue in your codebase, drafts a fix, and opens a signed PR —…",
  },
  {
    title: "Discord",
    path: docPath("/plugins/discord"),
    keywords: ["plugins", "discord"],
    excerpt: "Sends configurable embeds to a Discord webhook when Mushi events fire — popular with community and startup teams.",
  },
  {
    title: "Webhook events",
    path: docPath("/plugins/events"),
    keywords: ["plugins", "events", "webhook"],
    excerpt: "Every event ships with this envelope:",
  },
  {
    title: "GitHub Issues",
    path: docPath("/plugins/github-issues"),
    keywords: ["plugins", "github-issues", "github", "issues"],
    excerpt: "Opens a labelled GitHub issue when a report is classified, with a backlink to the Mushi report drawer.",
  },
  {
    title: "Jira Cloud",
    path: docPath("/plugins/jira"),
    keywords: ["plugins", "jira", "cloud"],
    excerpt: "Bidirectional sync between Mushi reports and Jira Cloud issues — creates issues on report.classified, syncs status, and comments fix summaries on fix.applied.",
  },
  {
    title: "Linear",
    path: docPath("/plugins/linear"),
    keywords: ["plugins", "linear"],
    excerpt: "Files a Linear issue automatically when the Mushi classifier categorises a report.",
  },
  {
    title: "Microsoft Teams",
    path: docPath("/plugins/msteams"),
    keywords: ["plugins", "msteams", "microsoft", "teams"],
    excerpt: "Delivers Adaptive Cards to a Teams incoming webhook when reports are classified or fixes land.",
  },
  {
    title: "PagerDuty",
    path: docPath("/plugins/pagerduty"),
    keywords: ["plugins", "pagerduty"],
    excerpt: "Pages your on-call rotation when a P0 or P1 report lands in Mushi.",
  },
  {
    title: "Rollbar",
    path: docPath("/plugins/rollbar"),
    keywords: ["plugins", "rollbar"],
    excerpt: "Mirrors Mushi reports into Rollbar items and resolves them when fixes ship.",
  },
  {
    title: "Sentry",
    path: docPath("/plugins/sentry"),
    keywords: ["plugins", "sentry"],
    excerpt: "Two-way Sentry integration: Sentry errors flow into Mushi's queue, and Mushi fixes flow back — merging a fix resolves the linked Sentry issue, resolving in Sentry resolves the…",
  },
  {
    title: "Slack app",
    path: docPath("/plugins/slack"),
    keywords: ["plugins", "slack", "app"],
    excerpt: "Triage a bug from the channel it lands in. Mushi posts each classified report as a Block Kit card carrying the plain-English title, root cause, and evidence counts — and the…",
  },
  {
    title: "Zapier",
    path: docPath("/plugins/zapier"),
    keywords: ["plugins", "zapier"],
    excerpt: "Fan every Mushi event out to Zapier and wire it into any of the 6,000+ Zapier integrations — Slack, Notion, Google Sheets, HubSpot, Jira, and more.",
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
    excerpt: "dev.mushimushi:mushi-android ships shake detection (via SensorManager), a bottom-sheet capture UI, an offline queue with WorkManager-style retry, and an optional Sentry breadcrumb…",
  },
  {
    title: "Angular quickstart",
    path: docPath("/quickstart/angular"),
    keywords: ["quickstart", "angular"],
    excerpt: "Same loop as React — swap the install and boot call.",
  },
  {
    title: "Capacitor quickstart",
    path: docPath("/quickstart/capacitor"),
    keywords: ["quickstart", "capacitor"],
    excerpt: "Ship the same bug-report widget on iOS, Android, and web from one Capacitor shell.",
  },
  {
    title: "CLI ↔ console setup loop",
    path: docPath("/quickstart/cli-console-loop"),
    keywords: ["quickstart", "cli-console-loop", "cli", "console", "loop", "setup"],
    excerpt: "The fastest path from zero to a working SDK is npx mushi-mushi — the wizard handles project creation, key minting, and SDK installation in one command with no copy-paste. This…",
  },
  {
    title: "Flutter quickstart",
    path: docPath("/quickstart/flutter"),
    keywords: ["quickstart", "flutter"],
    excerpt: "Flutter quickstart — Mushi Mushi docs (/quickstart/flutter)",
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
    excerpt: "The MushiMushi Swift package ships shake-to-report, an SQLite-backed offline queue, automatic device-context capture, and an optional Sentry breadcrumb bridge.",
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
    excerpt: "Shake-to-report bug capture for React Native, Capacitor, Flutter, iOS, and Android — offline queue and Sentry bridge wired up by npx mushi-mushi.",
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
    excerpt: "Add a shake-to-report button to your iOS or Android app — same API key powers the widget and your editor tools.",
  },
  {
    title: "Svelte quickstart",
    path: docPath("/quickstart/svelte"),
    keywords: ["quickstart", "svelte"],
    excerpt: "Same loop as React — swap the install and boot call.",
  },
  {
    title: "Vue 3 quickstart",
    path: docPath("/quickstart/vue"),
    keywords: ["quickstart", "vue"],
    excerpt: "Same loop as React — swap the install and boot call.",
  },
  {
    title: "Vanilla JS quickstart",
    path: docPath("/quickstart/web"),
    keywords: ["quickstart", "web", "vanilla", "js"],
    excerpt: "For non-React apps (or any framework you'd rather drive imperatively).",
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
    excerpt: "Bug-reporting SDKs for React, Vue, Svelte, Angular, React Native, Capacitor, Flutter, iOS, Android, and Node — one npx mushi-mushi wizard installs any.",
  },
  {
    title: "@mushi-mushi/adapters",
    path: docPath("/sdks/adapters"),
    keywords: ["sdks", "adapters", "@mushi-mushi/adapters"],
    excerpt: "Inbound webhook translators that turn third-party observability events into Mushi Mushi reports — so an alert that fires in your existing monitoring also lands in your bug queue…",
  },
  {
    title: "Product analytics (track)",
    path: docPath("/sdks/analytics"),
    keywords: ["sdks", "analytics", "product", "track"],
    excerpt: "Mushi.track() reference — named events, consent, sampling, batching, the property contract, useMushiTrack() for React, the Users & Funnels console page, the POST /v1/sdk/events…",
  },
  {
    title: "dev.mushimushi:mushi-android (Android)",
    path: docPath("/sdks/android"),
    keywords: ["sdks", "android", "dev.mushimushi", "mushi-android"],
    excerpt: "Native Kotlin SDK on Maven Central. Uses SensorManager for shake detection, Jetpack Compose for the report UI, and WorkManager for a resilient offline queue.",
  },
  {
    title: "@mushi-mushi/angular",
    path: docPath("/sdks/angular"),
    keywords: ["sdks", "angular", "@mushi-mushi/angular"],
    excerpt: "Angular DI providers over @mushi-mushi/web. Shared wrapper notes: Framework wrappers.",
  },
  {
    title: "In-SDK Ask assistant",
    path: docPath("/sdks/assistant"),
    keywords: ["sdks", "assistant", "in-sdk", "ask"],
    excerpt: "The Mushi widget can show an Ask tab so end users get answers grounded in the current page context and an operator-authored knowledge corpus — using your BYOK LLM key, with every…",
  },
  {
    title: "@mushi-mushi/capacitor",
    path: docPath("/sdks/capacitor"),
    keywords: ["sdks", "capacitor", "@mushi-mushi/capacitor"],
    excerpt: "Capacitor plugin for Ionic / Capacitor apps. The web fallback uses @mushi-mushi/core so the plugin works in WebView previews; native iOS and Android delegate to the standalone…",
  },
  {
    title: "Capacitor bottom dock",
    path: docPath("/sdks/capacitor-bottom-dock"),
    keywords: ["sdks", "capacitor-bottom-dock", "capacitor", "bottom", "dock"],
    excerpt: "Use triggerInsetPreset for common mobile chrome:",
  },
  {
    title: "@mushi-mushi/cli",
    path: docPath("/sdks/cli"),
    keywords: ["sdks", "cli", "@mushi-mushi/cli"],
    excerpt: "Project setup, report triage, agentic fix dispatch, QA coverage, skill pipelines, and headless merge — all from the terminal.",
  },
  {
    title: "@mushi-mushi/core",
    path: docPath("/sdks/core"),
    keywords: ["sdks", "core", "@mushi-mushi/core"],
    excerpt: "Shared types, HTTP client, offline queue helpers, and config used by every framework SDK. Framework-agnostic — you rarely install this package directly.",
  },
  {
    title: "eslint-plugin-mushi-mushi",
    path: docPath("/sdks/eslint-plugin"),
    keywords: ["sdks", "eslint-plugin", "eslint", "plugin", "eslint-plugin-mushi-mushi"],
    excerpt: "Two lint rules that run as part of the v2 gates — no-dead-handler flags empty event handlers (onClick=}, onSubmit=) and no-mock-leak flags faker / placeholder data left in…",
  },
  {
    title: "mushi_mushi (Flutter)",
    path: docPath("/sdks/flutter"),
    keywords: ["sdks", "flutter"],
    excerpt: "Pure-Dart SDK on pub.dev. RepaintBoundary-driven screenshot capture, shake detection via sensorsplus, same offline-queue contract as the JS core SDK.",
  },
  {
    title: "Framework wrappers (Vue / Svelte / Angular)",
    path: docPath("/sdks/framework-wrappers"),
    keywords: ["sdks", "framework-wrappers", "framework", "wrappers", "vue", "svelte", "angular"],
    excerpt: "@mushi-mushi/vue, @mushi-mushi/svelte, and @mushi-mushi/angular are thin idiomatic shells over @mushi-mushi/web. Each package depends on web and calls Mushi.init once — do not…",
  },
  {
    title: "@mushi-mushi/inventory-auth-runner",
    path: docPath("/sdks/inventory-auth-runner"),
    keywords: ["sdks", "inventory-auth-runner", "inventory", "auth", "runner", "@mushi-mushi/inventory-auth-runner"],
    excerpt: "A small Playwright runner that executes the auth.scripted block of your inventory.yaml, captures the resulting cookies, and stores them in projectsettings so the v2 crawler and…",
  },
  {
    title: "@mushi-mushi/inventory-schema",
    path: docPath("/sdks/inventory-schema"),
    keywords: ["sdks", "inventory-schema", "inventory", "schema", "@mushi-mushi/inventory-schema"],
    excerpt: "Source of truth for inventory.yaml — Zod schema, JSON Schema, and the TypeScript types every other v2 surface depends on. The admin ingester, the gate runner, the LLM proposer…",
  },
  {
    title: "MushiMushi (iOS)",
    path: docPath("/sdks/ios"),
    keywords: ["sdks", "ios", "mushimushi"],
    excerpt: "Native Swift SDK. SwiftPM-first, CocoaPods supported.",
  },
  {
    title: "mushi-mushi (launcher)",
    path: docPath("/sdks/launcher"),
    keywords: ["sdks", "launcher", "mushi-mushi"],
    excerpt: "npx mushi-mushi is the single entry point on npm: it auto-detects your framework, picks the right @mushi-mushi/ SDK, writes MUSHIPROJECTID and MUSHIAPIKEY into .env.local, and…",
  },
  {
    title: "@mushi-mushi/mcp",
    path: docPath("/sdks/mcp"),
    keywords: ["sdks", "mcp", "@mushi-mushi/mcp"],
    excerpt: "MCP server for Cursor, VS Code, Windsurf, Cline, Claude, Zed, and other MCP clients — reports, plain-English reads, and fix briefs in the editor. → Connect for a one-click…",
  },
  {
    title: "@mushi-mushi/mcp-ci",
    path: docPath("/sdks/mcp-ci"),
    keywords: ["sdks", "mcp-ci", "mcp", "@mushi-mushi/mcp-ci"],
    excerpt: "The Mushi v2 GitHub Action — runs the five-gate composite check, drafts inventory entries from a recent crawl, and bootstraps an authenticated session for crawler / synthetic…",
  },
  {
    title: "MCP tools (generated)",
    path: docPath("/sdks/mcp-tools.generated"),
    keywords: ["sdks", "mcp-tools.generated", "mcp", "tools.generated", "tools", "generated"],
    excerpt: "Auto-generated from packages/mcp/src/catalog.ts. Do not edit by hand — run pnpm gen:mcp-tools-doc.",
  },
  {
    title: "Next.js App Router + CSP",
    path: docPath("/sdks/nextjs-app-router-csp"),
    keywords: ["sdks", "nextjs-app-router-csp", "nextjs", "app", "router", "csp", "next.js"],
    excerpt: "Mount Mushi inside a client component:",
  },
  {
    title: "Next.js static export",
    path: docPath("/sdks/nextjs-static-export"),
    keywords: ["sdks", "nextjs-static-export", "nextjs", "static", "export", "next.js"],
    excerpt: "Static exports cannot rely on server-side runtime configuration. Either keep the public Mushi env vars in NEXTPUBLIC or disable runtime config explicitly.",
  },
  {
    title: "@mushi-mushi/node",
    path: docPath("/sdks/node"),
    keywords: ["sdks", "node", "@mushi-mushi/node"],
    excerpt: "Server-side SDK for Node.js apps — forward unhandled exceptions, attach HTTP error-handler middleware to Express / Fastify / Hono, and tag every report with the route, request id…",
  },
  {
    title: "@mushi-mushi/plugin-sdk",
    path: docPath("/sdks/plugin-sdk"),
    keywords: ["sdks", "plugin-sdk", "plugin", "sdk", "@mushi-mushi/plugin-sdk"],
    excerpt: "Build a Mushi plugin in TypeScript. Plugins are HTTPS receivers that subscribe to lifecycle events; the SDK handles signature verification, delivery deduplication, and structured…",
  },
  {
    title: "SDK presets",
    path: docPath("/sdks/presets"),
    keywords: ["sdks", "presets", "sdk"],
    excerpt: "Presets are additive defaults. Any explicit Mushi.init() option wins.",
  },
  {
    title: "@mushi-mushi/react",
    path: docPath("/sdks/react"),
    keywords: ["sdks", "react", "@mushi-mushi/react"],
    excerpt: "React provider + hooks. Wraps @mushi-mushi/web.",
  },
  {
    title: "@mushi-mushi/react-native",
    path: docPath("/sdks/react-native"),
    keywords: ["sdks", "react-native", "react", "native", "@mushi-mushi/react-native"],
    excerpt: "Let testers shake their phone when something feels broken — the native SDK captures console logs, network errors, and screenshots, then queues reports offline until connectivity…",
  },
  {
    title: "Sentry Replay coexistence",
    path: docPath("/sdks/sentry-replay-coexistence"),
    keywords: ["sdks", "sentry-replay-coexistence", "sentry", "replay", "coexistence"],
    excerpt: "Initialize Sentry first, then Mushi. Mushi reads Sentry event and replay IDs when available and sends them with the report.",
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
    excerpt: "Svelte / SvelteKit boot helpers over @mushi-mushi/web. Shared wrapper notes: Framework wrappers.",
  },
  {
    title: "@mushi-mushi/vue",
    path: docPath("/sdks/vue"),
    keywords: ["sdks", "vue", "@mushi-mushi/vue"],
    excerpt: "Vue 3 plugin + composables over @mushi-mushi/web. Shared wrapper notes: Framework wrappers.",
  },
  {
    title: "@mushi-mushi/wasm-classifier",
    path: docPath("/sdks/wasm-classifier"),
    keywords: ["sdks", "wasm-classifier", "wasm", "classifier", "@mushi-mushi/wasm-classifier"],
    excerpt: "Optional on-device pre-classifier built on a Phi-3-mini ONNX model running under onnxruntime-web. Detects obvious junk before the request even leaves the browser, cutting your LLM…",
  },
  {
    title: "@mushi-mushi/web",
    path: docPath("/sdks/web"),
    keywords: ["sdks", "web", "@mushi-mushi/web"],
    excerpt: "Browser SDK: screenshots, console logs, network breadcrumbs, and a shake-to-report widget in a Shadow DOM so your CSS never leaks in or out.",
  },
  {
    title: "Security & compliance",
    path: docPath("/security"),
    keywords: ["security", "compliance"],
    excerpt: "How Mushi Mushi protects bug-report data — residency, bring-your-own keys and storage, retention sweeps, nightly RLS coverage, prompt-injection defence, SOC 2 readiness, status…",
  },
  {
    title: "BYO storage",
    path: docPath("/security/byo-storage"),
    keywords: ["security", "byo-storage", "byo", "storage"],
    excerpt: "By default screenshots and crash dumps go to a Mushi-managed Supabase Storage bucket. BYO storage lets you pin them to your own bucket instead — credentials live in Vault, URLs…",
  },
  {
    title: "Bring-your-own-key",
    path: docPath("/security/byok"),
    keywords: ["security", "byok", "bring-your-own-key"],
    excerpt: "Mushi supports project-scoped BYOK. When set, every classifier, judge, fix orchestrator, and intelligence-report run for that project uses your key — usage shows up in your…",
  },
  {
    title: "Data residency",
    path: docPath("/security/data-residency"),
    keywords: ["security", "data-residency", "data", "residency"],
    excerpt: "Mushi Cloud is designed for regional isolation — separate Supabase projects per region with no inter-region replication. As of June 2026, all production traffic runs on a single…",
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
    excerpt: "Bug reports are user-supplied content fed directly into LLMs. That makes prompt injection a first-class threat — a malicious user could craft a report body that overrides the…",
  },
  {
    title: "SOC 2 readiness",
    path: docPath("/security/soc2"),
    keywords: ["security", "soc2", "soc", "readiness"],
    excerpt: "Mushi ships a SOC 2 Type 1 readiness module. It is not a third-party certification on its own — but it generates the evidence auditors need and keeps it current automatically.",
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
    excerpt: "The admin console is a Vite + React SPA that talks directly to your Supabase project and the api edge function. It has no server runtime — any static host works.",
  },
  {
    title: "Self-host in minutes (Docker Compose)",
    path: docPath("/self-hosting/docker-compose"),
    keywords: ["self-hosting", "self", "hosting", "docker-compose", "docker", "compose", "self-host", "minutes"],
    excerpt: "The fastest way to run the whole Mushi stack on your own box. One Compose file brings up Postgres, Auth, REST, Storage, the edge functions, the admin console, and a Caddy reverse…",
  },
  {
    title: "Edge Functions deploy",
    path: docPath("/self-hosting/edge-functions"),
    keywords: ["self-hosting", "self", "hosting", "edge-functions", "edge", "functions", "deploy"],
    excerpt: "Mushi ships Supabase Edge Functions under packages/server/supabase/functions/ (run pnpm docs-stats for the live count — currently 55). For a working self-host you only need the…",
  },
  {
    title: "Langfuse + Sentry",
    path: docPath("/self-hosting/observability"),
    keywords: ["self-hosting", "self", "hosting", "observability", "langfuse", "sentry"],
    excerpt: "Mushi ships with first-class Langfuse (LLM traces) and Sentry (error tracking) integration. Both are configured as Edge Function secrets.",
  },
  {
    title: "Supabase setup",
    path: docPath("/self-hosting/supabase"),
    keywords: ["self-hosting", "self", "hosting", "supabase", "setup"],
    excerpt: "Run these commands from packages/server/ — the Supabase CLI looks for supabase/ relative to the current directory.",
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
    excerpt: "A debugging checklist for when a Lovable, Bolt, Cursor or Claude Code app breaks for a real user and you did not write the code — reproduce, read the first error, find the file…",
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
