# Anti-Slop Burndown — SDK reliability docs (Jul 2026)

_Audit executed with doc authoring. Code comment trim (Phase C) deferred._

## Scope

- Surfaces audited: [x] Prose  [x] Visual  [x] Code  [x] Structure
- In scope: new/updated docs for CLI auth reliability, runtime config merge, widget UX, operator runbook, README fixes
- Out of scope: full repo re-audit, landing page hero, unrelated marketing ([`2026-06-gtm-directory.md`](2026-06-gtm-directory.md) GTM scope remains closed)

## Slop score (after doc execution)

| Surface | Findings | Closed | Remaining |
| --- | --- | --- | --- |
| Prose | 6 | 6 | 0 |
| Visual | 2 | 2 | 0 (internal only) |
| Code | 4 | 0 | 4 (optional Phase C) |
| Structure | 3 | 3 | 0 |

## Findings

### Prose & copy

| # | Location | Tell | Why it reads as AI | Recog | Effort | Status |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | `packages/web/README.md:25` | Wrong credential path (Settings vs Setup → Verify) | Copy-paste drift from generic SaaS “API keys page” | High | S | ✅ Fixed |
| P2 | New runtime docs | Risk of “production-readiness overhaul” framing | Enterprise audit voice, not vibe-coder symptom | Med | S | ✅ Avoided — lead with “banner vanished” |
| P3 | `packages/mcp/README.md` | Conflates ingest key with BYOK Settings path | Same generic API-keys-page pattern | Med | S | ✅ Fixed — MCP vs ingest vs BYOK split |
| P4 | Changelog/changeset | “Robust polling” phrasing | VOICE banned filler | Low | S | ✅ Changeset uses concrete 429/408 wording |
| P5 | New doc risk | Symmetrical 3-benefit triad | Model-default feature grid | Med | S | ✅ Used problem → table → fix structure |
| P6 | `cli-console-loop.mdx` | Already concrete | ASCII terminal box + symptom table | Low | — | ✅ Extended, not re-voiced |

### Visual & UI (internal)

| # | Location | Tell | Recog | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| V1 | Admin `runStatusChipTone()` migration | Uniform status chips across pages | Low | S | ✅ Documented in operator runbook as pattern; no public doc |
| V2 | Onboarding progress bar | Generic stepper | Low | — | ✅ Kept; step icons add hierarchy |

### Code

| # | Location | Tell | Recog | Effort | Direction | Status |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | `sdk-config.ts:1-23` | Banner FILE comment restates file | Med | S | Trim to 3-line module doc + link `SDK_RUNTIME_CONFIG.md` | Deferred Phase C |
| C2 | `CliAuthPage.tsx:1-29` | Same banner pattern | Med | S | One-line route purpose; flow lives in docs | Deferred Phase C |
| C3 | `sdk-config.ts` inline essay | Generated architecture tone | Med | S | Point to deep-dive doc | Deferred Phase C |
| C4 | Status chip dedup | Near-identical chip classes removed | — | — | Anti-slop win | ✅ Noted in operator doc |

### Structure & IA

| # | Tell | Direction | Status |
| --- | --- | --- | --- |
| S1 | Same mermaid in MDX + SDK_*.md + AGENTS | MDX: simplified CLI diagram; deep-dive: full data-flow; AGENTS: table only | ✅ |
| S2 | README + MDX + deep-dive repeating quick start | README: short runtime section + link; MDX: setup steps; deep-dive: precedence only | ✅ |
| S3 | Operator runbook vs AGENTS duplication | AGENTS: inventory; operator doc: deploy checklist | ✅ |

## Phased burndown — results

- **Phase A — Copy accuracy** ✅ P1 fixed; P2/P4/P5 avoided in new prose; P3 tracked separately
- **Phase B — Structure dedup** ✅ S1–S3 applied during authoring
- **Phase C — Code comment trim** ⏳ Optional — `sdk-config.ts`, `CliAuthPage.tsx` (user approval)
- **Phase D — Verify** ✅ Voice spot-check against `docs/marketing/VOICE.md` banned list on new files

## Docs delivered (this execution)

| File | Role |
| --- | --- |
| `apps/docs/content/concepts/runtime-config.mdx` | Public setup + troubleshooting |
| `apps/docs/content/quickstart/cli-console-loop.mdx` | Reliability + expanded symptom table |
| `apps/docs/content/sdks/web.mdx` | Runtime merge, capture, draft callouts |
| `docs/SDK_RUNTIME_CONFIG.md` | Maintainer precedence deep-dive |
| `docs/operators/sdk-reliability-overhaul.md` | Deploy + migration checklist |
| `packages/web/README.md`, `packages/cli/README.md` | npm-facing accuracy |
| `AGENTS.md`, `docs/DEPLOYMENT.md` | Agent + maintainer inventory |

## Manual follow-up

1. **Phase C:** Trim FILE banners in `sdk-config.ts` and `CliAuthPage.tsx` if desired
2. **Re-run voice checks** after npm publish if GTM copy references reliability (`pnpm check:public-voice`)

## Verify

- [x] Public docs lead with symptoms and setup steps, not audit jargon
- [x] Single diagram tier per topic (summary MDX vs deep-dive)
- [x] `packages/web/README.md` ingest key path corrected
- [x] `packages/mcp/README.md` ingest/MCP/BYOK paths clarified
