# GTM scorecard — Mushi Mushi

Append-only. One row per week (Monday). Numbers come from `GET /v1/admin/growth/funnel`
(`company_funnel_weekly`) once Phase 1 ships; before that, from the SQL in
`docs/plan-gtm.md` → Workstream C §8. Sources for the "how did you hear" split:
`auth.users.raw_user_meta_data->>'signup_source'`.

North-star: **activated external projects / week** (a non-founder project receives its
first SDK-originated report). `unmeasured` is a value; never invent a number.

| Week (ISO) | Visits (lower bound) | Signups | Projects | Keys | SDK installed | Activated | Fix pulled | Habit | Paid | Top source | Top drop-off | Experiment shipped | Launch / post |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-W38 (baseline, 2026-09-20) | unmeasured (GitHub 25 uniques / 14 d) | 0 this week · 9 all-time | 0 · 11 all-time (4 external) | 0 | 0 (last `sdk_first_heartbeat` 2026-07-19) | **0** (0 of 4 external ever) | 0 | 0 | 0 | unmeasured (no `signup_source` yet) | Signup → first report (0/4) | Phase 1: `product_events` + `track()` + `signup_source` + `/growth` | none (no launch has ever run) |

## Phase 1 status — 2026-09-20 (Measure & message)

| Piece | State | Evidence |
|---|---|---|
| `product_events` table, RLS, retention cron, hardening | **deployed verified** | migrations `20260921000001` + `20260921000003` applied; advisors clean for the new objects; anon read = 0 rows, anon insert = 42501 |
| `company_funnel_weekly` RPC + `operator_users` + widened `setup_funnel_events` CHECK | **deployed verified** | migration `20260921000002` applied; RPC returns 8 weeks (all 0, matches baseline), `self_project_configured = true` |
| `POST /v1/sdk/events`, server emits, `GET /v1/admin/growth/funnel`, operator gate | **deployed verified** | `api`, `mcp`, `stripe-webhooks` redeployed; live probe: batch accepted 2, identify stitched 3 rows, dedup replay accepted 0, bad key 401, growth route 401 unauthenticated; probe rows and key deleted |
| Secrets `MUSHI_SELF_PROJECT_ID`, `MUSHI_OPERATOR_USER_IDS`; self project retention 730 d | **deployed** | `supabase secrets set`; `project_settings.events_retention_days = 730` |
| SDK `track()` / `setConsent()` / `getAnonymousId()` (`@mushi-mushi/core`, `web`, `react`) | **repository green** (not published) | core 248 tests, web 229, react 7; changeset `.changeset/track-product-analytics.md` |
| Console: `signup_source` field, `trackSelf`, 7 event call sites, `/growth` page | **repository green** (not deployed) | admin typecheck clean, 703 tests |
| Docs site: SDK + consent bar, landing events, hero CTAs with `?src=`, pricing CTA | **repository green** (not deployed) | public-voice, tagline, llms.txt, 46 docs tests |

Also done 2026-09-20: dedicated `self-funnel-web` ingest key minted on the self project; GitHub Actions secrets `MUSHI_SELF_API_KEY` / `MUSHI_SELF_PROJECT_ID` / `MUSHI_SELF_API_ENDPOINT` set; `deploy-admin.yml` and `deploy-docs.yml` now pass them as `VITE_MUSHI_SELF_*` / `NEXT_PUBLIC_MUSHI_SELF_*` (before this, the deployed console's dogfooding was silently off because the key was never passed to CI). `MUSHI_DEMO_*` secrets for the keyless `/connect` demo are still absent — a launch-gate item.

2026-09-21: Phase 1 is PR #394 (`feat/gtm-phase1-measure`). Show HN gate item #1 done: demo project `mushi-demo` (id `1946e098-0103-4d87-98f1-4543199402b5`, founder org, excluded from the company funnel) seeded with 5 classified reports via `scripts/marketing/seed-demo.mjs` (script fixed: it sent classifier categories that both ingest validators rejected); read-only `mcp:read` key + `MUSHI_DEMO_*` GitHub Actions secrets set so `/docs/connect` becomes keyless on the next docs deploy. Seed keys revoked after use.

Owed before the funnel fills: merge PR #394 (deploys admin and docs via GitHub Actions); enable GitHub OAuth in the Supabase dashboard (currently only Google is enabled); verify `/docs/connect` keyless demo after the deploy.

## Phases 2–4 status — 2026-09-21 (Activate · Be found · Launch & loop)

| Piece | State | Evidence |
|---|---|---|
| Users & Funnels RPCs (`product_events_summary/funnel/paths/people/retention`), `GET /v1/admin/events/*`, MCP tools `query_funnel` / `get_product_events_summary` / `get_user_paths` | **deployed verified** | migration `20260921000004` applied; fixture (3 persons, 7 events) returned exactly the expected numbers for all five RPCs; `api` + `mcp` redeployed; MCP catalog 76 tools, sync checks green |
| First-run: signup → `/onboarding`, two-screen wizard with inline diagnosis (realistic fixture, polling state machine), empty states, click-triggered 4-stop tour, GitHub button first, legal line | **repository green** (not deployed) | admin typecheck + tests; `activation-setup-builder` required steps = 3; `test_report_sent` owned by the server (dedup per report) |
| Lifecycle emails (`lifecycle-emails` function, day-0/2/7 copy, unsubscribe HMAC route, console toggle) | **deployed, switched off** | migration `20260921000005`; cron `37 * * * *` returns early while `mushi_runtime_config.lifecycle_emails_enabled='false'`; `LIFECYCLE_UNSUB_SECRET` set; **`RESEND_FROM_EMAIL` on a verified sending domain still owed before flipping the flag** |
| Legal (`/legal/privacy`, `/legal/terms` drafts for founder review), `/security` trust summary, footer with legal links, landing/pricing without sidebar, testers dead links fixed, CloudFront `/legal` routing | **repository green** (not deployed) | public-voice 105 surfaces OK; docs typecheck + 54 tests |
| Five compare/how-to pages with dated fact tables (unverified facts marked), honest `/launch-week` rewrite, Show HN / PH / Reddit copy in `snippets.md`, journey post #1, `sdks/analytics` reference, Community (Discussions) section | **repository green** (not deployed) | llms.txt 201 pages; MCP docs index regenerated (dead `/guides/*` links gone, 10/10 sampled URLs 200) |
| Growth loop: "Bug reports by Mushi" widget mark (link + `loop_impression`/`loop_click`), runtime `widget.brandFooter` (Free Cloud on, paid/self-host off), console tri-state toggle, RN + Node `track()` | **repository green**, server side deployed | migration `20260921000006`; web bundle 88.96 kB under a raised 92 kB budget |
| Ingest fix: `/v1/reports` now accepts the user∪classifier category union (feedback/question/feature no longer 400) | **deployed** | found via the seed script; Deno test covers a `feedback` report |

### Resolved 2026-09-21

| Item | Evidence |
|---|---|
| GitHub OAuth enabled on the live project | `/auth/v1/settings` → `external.github: true` |
| Competitor facts on the compare pages verified against primary sources | every fact in `apps/docs/content/compare/_facts.ts` carries its `sourceUrl`; nothing is marked unverified |
| Does hosted-LLM billing block a new user's first diagnosis? **No, not today.** | `MUSHI_HOSTED_LLM_BILLING` runs in `shadow`: every mushi row in `kensaurus_wallet_ledger` (latest 2026-09-20 17:19Z) is a $0 debit with `metadata.shadow = true`, and `hostedLlmPreflight` returns "allowed" unless the mode is exactly `on` |
| `first_report_received` could stamp a project that already had reports | emitter now checks the project's oldest reports first (`_shared/first-report.ts`, 7 Deno tests); no bad rows existed in production |

### Still owed by the founder

1. **Merge PR #394.** This redeploys every edge function from master, plus the console and the docs site. The console and the docs site only get the Users & Funnels UI, compare pages, legal pages, hero CTAs and consent bar from this merge.
2. **Publish the SDKs.** Merging the changesets "Version packages" PR publishes `track()` / `setConsent()` to npm. Until then customers cannot call them.
3. **Email.** Production has no `RESEND_API_KEY` or `RESEND_FROM_EMAIL`, so no transactional email has ever been sent. Verify a sending domain in Resend, set both secrets, then `update mushi_runtime_config set value='true' where key='lifecycle_emails_enabled'`.
4. **Supabase Auth redirect allowlist** must include the console's `/onboarding` path, or email-confirm and OAuth sign-ups fall back to the dashboard.
5. **Legal.** Both pages are marked as drafts. Choose the governing law and venue (terms §14), have them reviewed, then restore the "By creating an account you agree…" line in `LoginPage.tsx`. The tester consent checkboxes (`TesterWelcomeEnroll.tsx`, `apps/testers/app/join/page.tsx`) already point at the draft terms.
6. **Before switching billing to `on`.** A brand-new owner has no kenji wallet, so `kensaurus_wallet_check` answers `no-wallet` and the preflight would refuse their first diagnosis. Give new mushi owners a free grant first, or treat `no-wallet` as allowed for Free Cloud.
7. **Hero GIF** (human screen capture of the incident loop), then run R1 Show HN per `docs/marketing/launch-week.md`.
8. **Uncommitted STT billing work.** The STT billing change in the working tree (`_shared/stt.ts`, `telemetry.ts`, `hosted-llm-billing.ts`, `hosted-model-prices.ts`, `classify-stage2-schema.ts`, `classify-report`) is not in production and not in PR #394.
