# Anti-Slop Burndown — mushi-mushi (console + remaining prose)

_Audit Jul 19 2026. Landing history lives in [`apps/docs/plan-antislop.md`](../apps/docs/plan-antislop.md) (mostly executed)._

## Scope

- Surfaces audited: [x] Prose  [x] Visual  [x] Code  [x] Structure
- Out of scope: VISION north-star rewrite; mass FILE-banner deletion (policy only unless a file is already touched)
- Voice source: [`docs/marketing/VOICE.md`](./marketing/VOICE.md) (bans unlock/seamless/leverage/…)

## Slop score (at audit)

| Surface | Findings | High-recognizability | Top quick win |
|---------|----------|----------------------|---------------|
| Prose | ~12 | Onboarding Unlock CTA; rewards unlock; closed-loop Taleb essay | Kill banned CTAs |
| Visual | ~4 | HeroIntro glow; PersonaTrack 3-up | Remove halo |
| Code | ~2 | FILE/PURPOSE banners (~1.5k admin) | Ban new banners |
| Structure | ~5 | Onboarding dual hero; README star emoji; TODO(loop-video) | One hero |

## Findings (execution targets)

### Prose

| # | Location | Tell | Recog | Effort | Direction |
|---|----------|------|-------|--------|-----------|
| P1 | `OnboardingPage.tsx` Unlock CTA | Banned filler | High | S | Concrete verb |
| P2 | `OnboardingPage.tsx` repair loop / Meet Ask Mushi | Jargon + Meet… cadence | High | S | Concrete steps / action |
| P3 | `rewards.mdx` unlock/engagement | SaaS pad | High | S | One mechanic sentence |
| P4 | `closed-loop.mdx` Taleb / Antifragile | Essay-slop | High | M | Keep 5-step practice; cut citation theater |
| P5 | `ClosingCta` / landing-copy Ready to try | Default closer | High | S | `npx mushi-mushi` |

### Visual

| # | Location | Tell | Recog | Effort | Direction |
|---|----------|------|-------|--------|-----------|
| V1 | `HeroIntro.tsx` blur-3xl halo | Generic glow | High | S | Remove |
| V2 | `PersonaTrack.tsx` 3 identical cards | Card-grid monotony | High | M | Break symmetry |
| V3 | Onboarding dual PageHero + editorial Card | Dual hero | High | M | Keep one |

### Structure / code

| # | Location | Tell | Direction |
|---|----------|------|-----------|
| S1 | README star emoji CTA | Emoji footer | Plain “Star the repo” |
| S2 | TODO(loop-video) visible | Placeholder | Hide until asset exists |
| C1 | Admin FILE/PURPOSE banners | Template comments | No new banners; strip when touching |

## Phased burndown

- **AS-1 Copy** — P1–P5 (this pass)
- **AS-2 Visual** — V1–V3 (this pass)
- **AS-3 Structure** — S1–S2 (this pass if cheap)
- **AS-4 Code** — C1 policy only (no mass sweep)

## Execution status (Jul 19 2026)

| Phase | Status |
|-------|--------|
| AS-1 Copy | Done — Onboarding CTAs/jargon; rewards intro; closed-loop Taleb cut; landing ClosingCta → `npx mushi-mushi` |
| AS-2 Visual | Done — HeroIntro halo removed; PersonaTrack featured+2; Onboarding dual hero → PageHero only |
| AS-3 Structure | Done — README TODO(loop-video) comment removed; star emoji CTA softened |
| AS-4 Code | Policy only — no mass FILE-banner sweep |

Re-run this audit after the next console UI pass to confirm no regressions.
