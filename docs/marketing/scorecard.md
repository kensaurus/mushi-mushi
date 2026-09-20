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

Owed before the funnel fills: commit + push (deploys admin and docs via GitHub Actions); enable GitHub OAuth in the Supabase dashboard (currently only Google is enabled); rewrite `apps/docs/content/launch-week.mdx` before any Show HN.
