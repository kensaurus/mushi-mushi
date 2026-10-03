# Portfolio positioning — selling Mushi to the one person running many apps

> Status: draft for the owner, 2026-10-02. Nothing here is live copy yet.
> Product spec: [Plan 020](../execplans/portfolio-operator.md), built on [Plan 019](../execplans/app-recipe-control-plane.md) and [ADR 0016](../adr/0016-mushi-as-the-app-recipe-control-plane.md).
> Voice: [VOICE.md](./VOICE.md) applies to every line. Canonical URLs: [canonical-urls.md](./canonical-urls.md).
> **Positioning changes need the owner's ADR.** §9 proposed one; it was accepted as [ADR 0017](../adr/0017-strike-the-plan-019-020-sequencing-gate.md) on 2026-10-02, and the §9.2 VISION.md / AGENTS.md diff is applied.

## 0. The rule for this whole document

**A page about a capability ships only after the capability is live**, with real numbers from the live dashboard (VOICE: "Numbers in copy should be real numbers"). Each keyword cluster and page below carries the Plan 020 phase it waits for. Writing the page early is how the 2026-10-02 store audit found "162 lessons" and "photos never leave your phone" on live listings. Mushi must not ship the same mistake about itself.

---

## 1. What does not change

These strings are guarded by `scripts/check-positioning-consistency.mjs` and `scripts/check-tagline-consistency.mjs`. This document proposes no edit to any of them:

- the north star: *"Your AI shipped it. Mushi tells you why it broke — in plain English, in your editor, with the fix ready to go — so a bug costs you five minutes instead of your whole afternoon."*;
- the category: *"The bug mediator for AI-built apps"*;
- the buyer anchor: the solo / indie **vibe coder**;
- the three will-nots;
- the tagline ladder (VOICE.md v2). **No tagline variant is proposed.** ADR 0016 rejected a recipe-led tagline because it made the recipe the premise and repeated the ADR 0004 drift. A portfolio-led hero ("the operating system for your apps") would be the same drift, and is rejected here for the same reason.

The portfolio story is **Bucket B (the depth) and Bucket C (the fabric)**. It never takes the README first screen, the landing hero or the npm description.

## 2. The message

### 2.1 Who it is for

The same vibe coder, a year later. They shipped one app with Cursor or Claude Code, then a second, then a website for each, then a shared backend. Now they have five apps on two stores, six Supabase projects and a Sentry org, and something is always quietly broken somewhere.

### 2.2 The portfolio line (a section heading, not a tagline)

Use one of these as the heading of the landing's portfolio section and the use-case page H1. They are section copy, so the tagline guard does not apply, but they must not be reworded into hero variants.

- **"Five apps. One queue."** Short; it ties back to the mediator's "one queue".
- **"Mushi-chan checks all your apps, not just the one that's on fire."** In voice; good for a social post.
- **"The holes that never throw an error."** Good for the radar section and the demo post.

Support line (body copy): *"Mushi diagnoses the bug in front of you, then checks every app you run for the ones that never throw: storage you're paying for and can't see, a function anyone can call, a webhook that never fired, a store listing that says something your code doesn't do. Each one comes back as a plain-English explanation and a fix your agent can apply."*

### 2.3 The honest competitive claim

**Say:** "Nobody bundles this for a solo operator." Then, in one line each, what does exist: Sentry's Seer fixes what throws; Expo's MCP reads your Expo builds and store reviews; Supabase Advisors lint one project at a time; Aikido scans repos and cloud config; an AI editor with five vendor MCPs can check most things by hand, one session at a time.

**Never say:** "no other tool does this", "the only", "all-in-one", "replace your stack", "single pane of glass", or anything from VOICE.md's never-say list ("empower", "unlock", "seamless", "leverage", "best-in-class", "next generation", "10×"). Will-not 2 applies directly: every vendor the operator runs stays, and Mushi reads from it.

**The real competitor, named in our own docs:** a coding agent composing vendor MCPs. Today's audit was done exactly that way. Mushi's answer is what a session doesn't have: memory across days, a schedule, rules that join vendors (a function with no auth *and* a paid key *and* no traffic), least-privilege read-only keys, and a fix that arrives as a draft PR.

### 2.4 Proof points we can use (only once live)

| Proof | Phase it needs | Source |
|---|---|---|
| "Found 2.7 TB of storage we were paying for and couldn't see" | Plan 020 Phase 2 detector live on the owner's projects | Owner's own Supabase bill before and after |
| "Our own store listings said things our code didn't do" | Phase 2 claims-vs-code | Owner's 5 apps, before and after |
| "Mushi runs on Mushi: 7 projects, one portfolio" | Plan 019 P1 | `/portfolio` screenshot |
| A public diagram page for Mushi's own repo | Plan 020 Phase 1 | The page itself |

---

## 3. Keyword clusters (SEO)

Demand evidence is marked: **AC** = Google autocomplete confirms the phrase is searched (volume unknown); **hyp** = a hypothesis to validate in Search Console or a keyword tool before writing. Autocomplete was checked on 2026-10-02 for the repo-understanding cluster only.

| Cluster | Example queries | Intent | Page | Evidence | Waits for |
|---|---|---|---|---|---|
| **A. Repo understanding** | "visualize github repo", "github repo to diagram", "repo to diagram", "github repo to text for llm", "repo to prompt", "codebase digest for llm", "understand codebase using ai", "codebase architecture diagram", "gitingest alternative", "deepwiki alternative private repo", "deepwiki mcp" | Tool / do it now | Free tool page `/r/<owner>/<repo>` + `/tools/repo-diagram`; compare page (§5) | AC for all except "codebase digest for llm" and "deepwiki alternative private repo" (hyp) | 020 Phase 0 (private) / Phase 1 (public pages) |
| **B. Many apps, one person** | "manage multiple apps solo", "app portfolio dashboard", "indie hacker multiple projects dashboard", "solo founder multiple saas", "side projects dashboard" | Problem-aware | `/docs/use-cases/manage-multiple-apps` | hyp (SidePop, MakerPulse and ManageUp exist, which suggests demand) | 019 P1 + 020 Phase 1 |
| **C. Supabase across projects** | "supabase multiple projects", "supabase storage orphaned files", "supabase storage usage high", "supabase security advisor all projects", "supabase security definer function anon", "supabase rls check" | Problem / fix | `/docs/use-cases/supabase-multiple-projects` + a how-to post on orphaned storage | hyp; Supabase's own troubleshooting page on high storage usage shows the problem is common | 020 Phase 2 (detectors). The how-to post on orphaned storage can ship earlier as pure education, with no product claim |
| **D. Vibe-coded app security** | "vibe coding security checklist", "lovable app security", "vibe coded app supabase leak", "is my vibe coded app secure" | Fear / check | `/docs/use-cases/vibe-coded-app-security-check` | hyp; strong news pull (CVE-2025-48757, Escape.tech's 5,600-app scan) | 020 Phase 2 |
| **E. Store listings and review** | "app store rejection reasons 2026", "app store privacy label checker", "google play data safety form check", "app store and google play app name different", "app store screenshots wrong device" | Pre-submission | `/docs/use-cases/store-listing-check` | hyp | 020 Phase 1 (names, locales, privacy URL) / Phase 2 (claims vs code) |
| **F. Releasing many mobile apps** | "expo multiple apps release", "eas update multiple apps", "release multiple react native apps", "capacitor and expo same backend" | How-to | `/docs/use-cases/release-many-apps` | hyp | 020 Phase 2 (release calendar) |
| **G. Cost** | "supabase storage cost spike", "github actions cost private repo", "llm api cost per app", "openai key leaked bill" | Problem | Blog posts + spend section of use-case B | hyp | 020 Phase 2 for product claims; education earlier |
| **H. Japanese** | "個人開発 複数アプリ 管理", "deepwiki 使い方", "deepwiki 料金", "Supabase 複数プロジェクト" | Same as above, ja | ja versions of A and B | AC for the deepwiki pair; others hyp | Same phases; only if docs ship ja |

### 3.1 AEO (answer engines)

- **Answer-first paragraphs.** Each use-case page opens with a two-sentence answer an LLM can quote: what the problem is, and what Mushi does about it, with one number.
- **`.md` twins** of every use-case and public diagram page, linked from `llms.txt`. GitDiagram's `.md` pages and DeepWiki's MCP are the precedent: agents read them.
- **FAQ blocks with `FAQPage` JSON-LD** on use-case pages, reusing the existing `FaqList` component from `apps/docs/content/compare/`.
- **A free, no-auth remote MCP tool for public repos** (`get_repo_digest` / diagram on public repos) listed in the MCP registry. That is how DeepWiki and GitDiagram show up inside agents. It must be rate-limited and must expose public repos only.
- **Citations to vendor docs** on every factual line (Supabase's orphaning sentence, Play's quota page), so an answer engine quoting Mushi quotes something checkable.

### 3.2 The growth loop

The public diagram page is the one portfolio feature with a built-in loop, copied from Gitingest, GitDiagram and DeepWiki:

1. A URL pattern anyone can type: `kensaur.us/mushi-mushi/r/<owner>/<repo>`.
2. A README badge ("Architecture by Mushi") that links back.
3. The Mushi-only overlay: "this repo has an open-source Mushi widget? See which parts users report bugs in." This appears only if the repo's owner connects it.
4. The CTA on the page: "Connect this repo to get the diagram for your private apps, with your bugs on it."

Guardrails (Plan 020 §10.3): opt-in for private repos, public repos by default, paths validated against the real tree, a "generated from `<sha>`" label, unpublish on request.

---

## 4. Pages to create

| Page | Path | Waits for | Notes |
|---|---|---|---|
| Use case: manage several apps alone | `apps/docs/content/use-cases/manage-multiple-apps.mdx` | 019 P1 + 020 Phase 1 | Lead with the operator's day, not the feature list |
| Use case: Supabase across projects | `…/use-cases/supabase-multiple-projects.mdx` | 020 Phase 2 | The orphaned-storage how-to can ship first as a blog post |
| Use case: vibe-coded app security check | `…/use-cases/vibe-coded-app-security-check.mdx` | 020 Phase 2 | No fear-selling; cite the incidents, then the checks |
| Use case: store listing check | `…/use-cases/store-listing-check.mdx` | 020 Phase 1 / 2 | Pre-submission checklist; "not legal advice" stated plainly |
| Tool: repo diagram | `apps/docs/app/tools/repo-diagram` + `/r/[owner]/[repo]` | 020 Phase 1 | The growth-loop page |
| Blog: "One day, fifteen holes" | `apps/docs/content/blog/…` | Every item in it fixed and deployed (§7) | The demo narrative |
| Compare pages | `apps/docs/content/compare/…` | See §5 | Follow the `_facts.ts` + `FACTS_REVIEWED_AT` + `NEXT_REVIEW_DUE` pattern; vendor-page prices only |

All new pages register in `_meta.ts` and pass `check:internal-doc-links`.

---

## 5. Comparison-page candidates (honest)

Each page must say where the other tool is better. Prices come from vendor pages only; aggregator numbers are dropped, not quoted.

| Page | Honest framing | What we concede |
|---|---|---|
| **DeepWiki vs GitDiagram vs Gitingest vs Mushi for private repos** | All four turn a repo into something an LLM or a human can read. Mushi's version puts your live bugs and findings on the diagram and works on private repos you connect | DeepWiki's wikis are richer; GitDiagram's diagrams are free and instant for public repos; Gitingest and Repomix are better pure digests (local, no account) |
| **Port for solo founders vs Mushi** | Port's free tier (15 seats) is the only IDP a solo developer can use for free. Port is a blank canvas; Mushi ships a fixed recipe and starts from bugs | Port is far more flexible, has a real catalog and self-service actions, and is built for teams |
| **Expo EAS + Expo MCP and Mushi** (an "alongside" page, not a "vs") | Expo's MCP reads your builds, TestFlight crashes and store reviews. Mushi turns those into diagnosed reports and covers Capacitor apps, websites and the backend too | For Expo-only apps, Expo's own tools are closer to the build and free to start |
| **Supabase Advisors across many projects** (a how-to, not a "vs") | Advisors are excellent per project. Here is how to run them across six projects, and what they don't check (orphaned storage, grants copied between projects, functions spending paid keys) | Advisors are first-party and free; Mushi reads them, it doesn't replace them |
| **Aikido vs Mushi for vibe coders** | Aikido scans code, dependencies, secrets and cloud config with a free tier and an MCP. Mushi starts from bugs and covers the store, billing and backend holes Aikido doesn't model | Aikido is a real security product with far wider scanning; use it for that |
| Existing: Sentry vs Mushi, Sentry alternatives for solo founders | Unchanged; the canonical Sentry answer (VISION §1.6) stays verbatim | — |

Do not write: "Backstage vs Mushi" (wrong buyer; VISION §1.4), or any page that implies Mushi is an IDP, an APM or an MMP.

---

## 6. Landing sections

The hero, sub-hero and the first screen stay as they are (Bucket A). Proposed additions, below the existing "one queue" section:

1. **"Five apps. One queue."** A grid of the owner's real apps as cards (from `/portfolio`, Plan 019 P1), each with its worst state chip. Caption: the support line from §2.2. CTA: "See your apps' diagnoses" → sign up.
2. **"The holes that never throw."** Four example findings from the radar, each as a before/after card: orphaned storage (with the GB and the monthly cost), a store claim the code contradicts, a webhook that never fired, a function with no auth. Each card ends with the fix as it arrives: "draft PR", "prompt for your agent" or "one setting".
3. **"See any repo."** An input box: paste a public GitHub URL, get the diagram (Plan 020 Phase 1). Under it: "Private repos: connect GitHub."
4. Integrations strip (existing Bucket C) gains Expo, App Store Connect, Google Play, Supabase and PostHog logos **only once their connectors ship**.

No section uses "dashboard", "control plane", "operating system" or "platform" as its headline word. Those are ops-coded words, the same allergy VISION §1.5 names for "observability".

---

## 7. The demo narrative: "One day, fifteen holes"

**Publish only after every item is fixed and deployed** (repo memory: a public post describing a security hole before the fix is deployed discloses it). Anonymized: apps are described by kind, not name; no project refs, function names, keys or user data.

> One person. Five apps on two stores, five websites, six Supabase projects, one Sentry org. Every app had passed its own tests. None of them had thrown an error worth a page.
>
> **Morning.** A storage bill that had crept up for months. One project was paying for 2.7 TB of files that no table pointed to any more. Someone (an AI agent, as it happens) had cleaned up rows with SQL, which Supabase documents as leaving the file in the bucket. Nothing threw.
>
> **Late morning.** A database function that can read secrets had been copied from one project to another, and its grant came with it. Anyone holding the public key could call it. In another project, an app nobody used any more still had functions deployed with no auth, each one holding a paid API key. Nothing threw.
>
> **Lunch.** A search feature had been quietly returning nothing for days. Its API key had been revoked, and the health check never looked at that key. A Sentry webhook had been "connected" for weeks and had never delivered a single event. Nothing threw.
>
> **Afternoon.** The store listings. One said photos never leave the phone; the code uploads them. One promised a lesson count the app doesn't have. The iOS screenshots were taken on an Android emulator. The App Store and Play names didn't match. A Japanese developer's apps had no Japanese listing. An App Store rejection traced back to code: a demo persona left in, a missing AI-data disclosure, a privacy URL that didn't render.
>
> **Evening.** The fix agent had edited a file it had never read, because the code index was stuck on the wrong branch. CI spend sat almost entirely in two repos. The autofix spending caps were unset everywhere.
>
> Fifteen holes, and none of them reached a bug tracker. Each one took minutes to fix once someone saw it. This is what Mushi-chan now checks for, every day, across every app you connect, and each one comes back as a plain-English explanation and a fix your agent can apply.

Format variants: a blog post, a Show HN ("I run 10 apps alone; here are 15 holes none of them threw"), an X thread with one hole per post, and a 60-second screen recording of `/portfolio`. Launch rule (owner decision, 2026-10-02): one external post per release.

---

## 8. Measurement

- **North star stays first:** activated external projects per week. Portfolio content is judged by whether it moves sign-up → activation, not by traffic alone.
- Events: `repo_diagram:viewed`, `repo_diagram:published`, `repo_digest:copied`, `portfolio:viewed`, `radar_finding:fixed`, with `source` / UTM attribution, through the existing consent-gated docs analytics.
- Search Console: impressions and clicks per cluster (§3), reviewed in the weekly GTM loop (`docs/marketing/scorecard.md`).
- A cluster with no impressions after 8 weeks of a live page is cut, not padded.

---

## 9. Proposed amendments (for the owner; not applied)

### 9.1 Proposed ADR (number assigned at write time; read `docs/adr/INDEX.md` first)

**Title:** The portfolio operator is the vibe coder's second stage, not a new buyer.

- **Context.** The owner runs 5 store apps, 5 websites and 6 Supabase projects alone. A one-day audit found 15 holes that never threw. The landscape research found no product that bundles cross-vendor detection, non-runtime holes and PR fixes for one person (Plan 020 §2.2). ADR 0016 already made the recipe portfolio-native.
- **Decision.**
  1. The primary buyer stays the solo vibe coder. "Portfolio operator" names the same person with several apps; it is not a second buyer and never leads a public surface.
  2. The drift test gains one clarification: *a hole found before a user hits it is a bug fixed in zero minutes*. A portfolio feature passes if it prevents or explains a bug in at least one of the operator's apps. CI cost and spend still fail the test on their own and stay Advanced-mode, as ADR 0016 says.
  3. Portfolio and radar copy lives in Bucket B / C, on use-case and comparison pages and below the landing's first screen.
  4. The claim is "nobody bundles this for a solo operator", never "nobody does this".
- **Rejected.** A portfolio-led hero or tagline ("the operating system for your apps"): it repeats the ADR 0004 drift and the recipe-led tagline ADR 0016 rejected. A Backstage-style catalog: wrong buyer (VISION §1.4).
- **Consequences.** More surface to keep honest; mitigated by §0's "live before written" rule and the existing positioning guard, which passes unchanged.

### 9.2 Proposed VISION.md / AGENTS.md diff

This touches none of the guarded strings (north star, category, "vibe coder", the three will-nots). It builds on ADR 0016's proposed recipe diff and does not repeat it.

```diff
 VISION.md §1.4, table
 | **Primary buyer** | The solo / indie **vibe coder** — builds fast with AI (Cursor, Claude Code, Lovable, Bolt), ships to real users, then loses whole afternoons when something breaks because they don't fully grasp the generated code. |
+| **The same buyer, later** | The vibe coder who now runs several apps, sites and services alone — a **portfolio operator**. Same person, same editor, same diagnosis; Mushi also checks every app they connect for holes that never throw. Never a separate hero. |
 | **Secondary** | Small teams and agencies who feel the same pain at slightly larger scale. |

 VISION.md, "The 'is this drift?' test"
 - **Yes →** it's Bucket A or B. Can lead.
+  A hole found before a user hits it is a bug fixed in zero minutes: a check
+  that prevents or explains a bug in at least one app passes. Cost and CI
+  minutes on their own still do not.

 AGENTS.md "Positioning" block, after the "Primary buyer" paragraph
+**Portfolio operator** (ADR 0017) is the same vibe coder with several apps.
+Portfolio and radar features never lead a public surface; the claim is
+"nobody bundles this for a solo operator", never "nobody does this".
```

---

## Sources

- Repo-understanding tools and autocomplete evidence: https://github.com/coderamp-labs/gitingest · https://github.com/ahmedkhaleel2004/gitdiagram · https://news.ycombinator.com/item?id=42521769 · https://docs.devin.ai/work-with-devin/deepwiki · https://github.com/search?q=%22deepwiki.com%2Fbadge.svg%22&type=code · https://github.com/yamadashy/repomix · https://suggestqueries.google.com/complete/search?client=firefox&q=visualize%20github%20repo
- Competitors: https://mcp.sentry.dev/ · https://sentry.io/pricing/ · https://docs.expo.dev/mcp/ · https://help.aikido.dev/ai-and-dev-tools/aikido-mcp.md · https://www.port.io/pricing · https://supabase.com/blog/remote-mcp-server
- Demo facts: https://supabase.com/docs/guides/storage/management/delete-objects · https://supabase.com/docs/guides/troubleshooting/storage-unexpectedly-high-usage-or-exceed_storage_size_quota-errors-ae21a5
- Vibe-coding security context: https://www.superblocks.com/blog/lovable-rls-breach · https://escape.tech/state-of-security-of-vibe-coded-apps · https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-codegen-vulnerability-debt-2026
- Portfolio-dashboard demand signals: https://www.producthunt.com/p/sidepop · https://www.hunted.space/product/makerpulse
