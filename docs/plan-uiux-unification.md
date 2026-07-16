# Mushi Design-System Unification & Housekeeping Burndown

> **Status: ACTIVE (Jul 2026).** Junior-dev burndown tracker for cross-surface
> design-system coherence (admin console, docs/marketing, SDK web + RN widgets).
> Phases A–E scaffolding + guardrails landed in this pass; remaining long-tail
> rows (raw `<button>` migration, full `styles.ts` px sweep, PublicHome arbitrary
> Tailwind) stay checkbox-tracked below for junior pick-up.
> **Wave 2 (Connect / chrome / systemic coherence)** lives in
> [`docs/admin/CONSOLE-UIUX-UNIFICATION-WAVE2.md`](./admin/CONSOLE-UIUX-UNIFICATION-WAVE2.md).
> Prior chrome/posture burndowns are **closed** — see
> [`docs/admin/UX-UNIFICATION-BURNDOWN.md`](./admin/UX-UNIFICATION-BURNDOWN.md) and
> [`docs/docs-site/UX-UNIFICATION-BURNDOWN.md`](./docs-site/UX-UNIFICATION-BURNDOWN.md).
> This document is the follow-on for token SSOT, primitive sprawl, scale usage,
> and guardrail wiring.

**How to use this file:** pick any unchecked row in the burndown table or a
Phase A–E checkbox. Each item cites the canonical fix and file paths. Keep
behavior identical unless the row explicitly says otherwise. Run the
verification block at the end of the phase before marking done.

---

## 1. Preservation contract

**This pass enhances; it does not strip.**

- No feature / route / screen / state / prop / handler removal without explicit
  approval. Redundant-looking code → list as a *proposal*, never delete unilaterally.
- No fabricated data, content, copy, or API fields. Missing content →
  `[NEEDS REAL CONTENT]`.
- Every codebase claim cites a real path. Unverifiable → say so.
- Preserve I/O boundaries + business logic unless explicitly proposed + approved.
- Three intentional visual identities stay separate (unify *primitive source*
  and *guardrails*, not the brand hues):
  1. **Operator console** — amber/zinc oklch (`apps/admin` `@theme`)
  2. **Editorial / marketing / docs** — washi/vermillion `--mushi-*`
  3. **SDK widget** — washi/vermillion hex via `@mushi-mushi/core`
- Per [`docs/admin/SDK-UI-UNIFICATION-DECISIONS.md`](./admin/SDK-UI-UNIFICATION-DECISIONS.md):
  console lime `BetaBanner` vs SDK neon/brand banners, and web square vs RN
  circle FAB, are deliberate.

**Before any file change:** state in one line what currently works there that
must keep working.

**Three finding buckets** (kept separate in the violation log):

1. **Violates a documented rule** (token lint, STYLEGUIDE, CONTRIBUTING, ESLint)
2. **Subjective improvement** (hierarchy, clearer copy — preserve meaning)
3. **Needs design-system enhancement** (missing semantic token / scale)

---

## 2. Context & IA summary (Phase 0)

### Operator console (`apps/admin`)

- **User goal:** Triage bugs, dispatch fixes, connect SDK, operate the PDCA loop.
- **Primary task / key action:** Scan posture → act on banner CTA → work in
  primary UI (table / canvas / drawer).
- **IA map:**
  - Primary: status banner + primary work surface
  - Secondary: snapshot strip metrics, segmented tabs
  - Tertiary: feature guides / readouts (collapsed when banner covers story)
- **Relationships:** Canonical order is
  `PageHeaderBar → PagePosture (≤2/≤3 rows) → SegmentedControl → Primary work UI`
  ([`apps/admin/src/design-system/_design-system-README.md`](../apps/admin/src/design-system/_design-system-README.md)).
- **Current anti-pattern (residual):** interaction-primitive sprawl (raw
  `<button>`, hand-rolled overlays, parallel severity→class maps) under an
  otherwise coherent page chrome.
- **Proposed layout direction:** keep posture chrome; consolidate primitives
  under `components/ui/*` + `chipTone` recipes.

### Docs + marketing (`apps/docs` + `packages/marketing-ui`)

- **User goal:** Decide whether Mushi fits; install SDK / wire MCP.
- **Primary task:** Landing proof → Where to start → Connect / Quickstart.
- **IA map:** EditorialHero / cinematic landing → trust strips → interactive
  hubs (`/connect`, MigrationHub) → MDX prose.
- **Anti-pattern:** two parallel landing trees (docs `components/landing/*` vs
  marketing-ui `Hero` used on admin public pages) share the same H1 but no
  layout components.
- **Proposed direction:** document or converge on one Hero; keep `--mushi-*`
  tokens; migrate arbitrary Tailwind to semantic utilities.

### SDK widget (`packages/web` + `packages/react-native`)

- **User goal:** Report a bug / ask the assistant without leaving the host app.
- **Primary task:** Open launcher → describe → submit (optional Ask / My reports).
- **IA map:** Banner/FAB → panel steps → success stamp.
- **Anti-pattern:** colors tokenized; spacing/radius scales exist but unused
  (557 literal `px` in `styles.ts`); RN skips most scale imports.
- **Proposed direction:** value-for-value migrate px → `MUSHI_SPACING` /
  `MUSHI_RADIUS`; RN imports full scale set; enforce ≥44px touch targets.

---

## 3. Design-system spec (current + target)

### Canonical sources (today)

| Layer | Path | Status |
|-------|------|--------|
| DTCG primitives | [`packages/brand/tokens/brand.tokens.json`](../packages/brand/tokens/brand.tokens.json) | Canonical for editorial hex |
| Editorial CSS | [`packages/brand/src/editorial.css`](../packages/brand/src/editorial.css) | Generated; consumed by docs/marketing/admin islands |
| Orphaned TS twin | [`packages/brand/src/tokens.generated.ts`](../packages/brand/src/tokens.generated.ts) | Built, **never imported** |
| Operator `@theme` | [`apps/admin/src/styles/theme-tokens.css`](../apps/admin/src/styles/theme-tokens.css) | Canonical for console (152 `--color-*`) |
| Widget tokens | [`packages/core/src/design-tokens.ts`](../packages/core/src/design-tokens.ts) | Canonical for SDK; **hand-copied** palette drifts on `ok`/`danger` |
| Docs bridge | [`apps/docs/app/globals.css`](../apps/docs/app/globals.css) | Thin `--color-mushi-*` over brand |
| Ask-Mushi | [`apps/admin/src/styles/ask-mushi.css`](../apps/admin/src/styles/ask-mushi.css) | Local Monokai `--am-*` overrides |
| Recipes | [`apps/admin/src/lib/chipTone.ts`](../apps/admin/src/lib/chipTone.ts), [`motion-tokens.ts`](../apps/admin/src/lib/motion-tokens.ts) | Chip / motion recipes |
| Lint | [`packages/eslint-plugin-mushi-mushi`](../packages/eslint-plugin-mushi-mushi) | 13 rules; 6 in `recommended` |

### Competing systems

| System | Where used | Status | Collision |
|--------|------------|--------|-----------|
| Admin oklch `@theme` | Operator console | Canonical (admin) | Light mode remaps brand → vermillion |
| Brand `--mushi-*` | Docs, marketing-ui, testers, editorial islands | Canonical (public) | Dark values redeclared in docs `globals.css` |
| Core `MUSHI_COLORS_*` | Web + RN widget | Canonical (widget) | `ok`/`danger` ≠ brand jade / viz-danger |
| Ask-Mushi `--am-*` | Ask sidebar only | Local override | Shadows admin `--color-*` |
| Docs Nextra HSL primary | Docs chrome | Adapter | Retints via `--nextra-primary-*` |

### Gaps to enhance (not replace)

1. No shared **spacing / radius / type-size / elevation / z** at DTCG layer.
2. Brand lacks true semantic status (`ok/warn/danger/info`) — only `jade` + `viz-*`.
3. Core palette hand-maintained → drift from brand.
4. Admin type scale only `--text-2xs/3xs`; z-index untokenized.
5. Widget scales underused (557 px literals; RN missing imports).
6. `ease-stamp` + duration scale defined ~5× by hand.

### Target architecture

```
brand.tokens.json (DTCG: color + spacing + radius + type + elevation + z + motion + semantic status)
  ├─ build → editorial.css (--mushi-*)     → docs / marketing-ui / testers / admin editorial bridge
  ├─ build → core/design-tokens.ts        → web + RN widgets (generated, not hand-copied)
  └─ build → tokens.generated.ts          → wired exports (not orphaned)
check-token-parity.mjs gates brand ↔ core ↔ admin bridges
```

---

## 4. Surface inventory checklist

| Surface | Route / entry | Sub-screens / states | Mobile | Dark | Audited |
|---------|---------------|----------------------|--------|------|---------|
| Admin Dashboard | `/` `/dashboard` | posture, KPI, empty, error, skeleton | ✓ | ✓ | ☑ |
| Reports list | `/reports` | KPI strip, filters, empty | ✓ | ✓ | ☑ |
| Report detail | `/reports/:id` | compact posture, dispatch, CI | ✓ | ✓ | ☑ |
| Inbox | `/inbox` | tabs, snapshot, empty | ✓ | ✓ | ☑ |
| Fixes | `/fixes` | pipeline, drawers | ✓ | ✓ | ☑ |
| Connect | `/connect` | studio, SDK install, update center | ✓ | ✓ | ☑ |
| Integrations | `/integrations` | cards, credentials | ✓ | ✓ | ☑ |
| Settings | `/settings` | BYOK, scrollable tabs | ✓ | ✓ | ☑ |
| Projects | `/projects` | snapshot, guides | ✓ | ✓ | ☑ |
| Explore / Graph | `/explore` `/graph` | canvas, drawers | ✓ | ✓ | ☑ |
| Auth / public | `/login` `/signup` `/reset-password` | forms | ✓ | ✓ | ☑ |
| Public home (admin) | `PublicHomePage` | marketing-ui Hero | ✓ | ✓ | ☑ |
| Tester portal | `/tester/*` | separate accent remap | ✓ | ✓ | ☑ |
| Modals / Drawers | `Modal.tsx` `Drawer.tsx` | + ~8 hand-rolls | ✓ | ✓ | ☑ |
| Toasts | `lib/toast.tsx` | provider in App | ✓ | ✓ | ☑ |
| Ask Mushi | sidebar + `ask-mushi.css` | terminal palette | ✓ | ✓ | ☑ |
| Docs landing | `apps/docs` index MDX | cinematic landing | ✓ | ✓ | ☑ |
| Docs `/connect` | `apps/docs/app/connect` | outside Nextra shell | ✓ | ✓ | ☑ |
| Docs MDX chapters | `content/**` | heroes, diagrams | ✓ | ✓ | ☑ |
| marketing-ui | package | Hero, ClosingCta, canvas | ✓ | ✓ | ☑ |
| SDK web widget | Shadow DOM | report / ask / my reports | ✓ | ✓ | ☑ |
| SDK RN widget | bottom sheet / banner / FAB | 3 tabs | ✓ | ✓ | ☑ |

**Counts (Jul 2026 audit):** ~63 admin pages · ~543 admin component TSX · 13 ESLint rules · ~20 design check scripts.

---

## 5. Per-surface violation log

### Bucket 1 — Violates documented rule

| Surface | Finding | Evidence |
|---------|---------|----------|
| Guardrails | `no-raw-hex-in-widget` defined but not enabled in any eslint config | `packages/eslint-plugin-mushi-mushi/src/rules/no-raw-hex-in-widget.ts` |
| marketing-ui | Zero mushi design-token ESLint rules | `packages/marketing-ui/eslint.config.js` = base only |
| CI | `check:motion`, `check:chip-contrast`, many `audit-*.mjs` not in CI | `.github/workflows/ci.yml` vs `package.json` scripts |
| Admin | ~8 overlays with `role="dialog"` bypass `Modal`/`Drawer` | ConfigHelp, FirstRunTour, MergeFixPreflight, StageDrawer, MotionOverlay, EdgeInspector, DispatchFixPreflight, UpgradeNudge |
| Admin | 283 raw `<button>` vs `Btn` primitive | `check:raw-button-in-pages` exists; long-tail remains |
| Widget RN | Raw hex + magic `zIndex: 99998` | `MushiBottomSheet.tsx`, `MushiBanner.tsx` |
| Docs README | chrome-budget path incomplete (spec lives under examples) | `_design-system-README.md` L51 vs `examples/e2e-dogfood/tests/admin-chrome-budget.spec.ts` |
| marketing-ui README | References nonexistent `apps/cloud` | `packages/marketing-ui/README.md` |

### Bucket 2 — Subjective improvement

| Surface | Finding |
|---------|---------|
| Admin | 5 parallel severity→class maps (PageHero, Dashboard, InsightsRow, CHIP_TONE, PIPELINE_STATUS) |
| Admin | 7 competing `Page*` scaffolds; auth pages hand-roll `<h1>` |
| Admin | Emoji-as-status in live regions (Dashboard insights) |
| Admin | `EmptySectionMessage` lives in `report-detail/` but imported cross-feature |
| Docs | Two landing systems with identical H1, no shared layout |
| marketing-ui Hero | Eyebrow `aria-hidden` hides real positioning copy |
| Public pages | 312 arbitrary Tailwind values concentrated in PublicHome/PublicIntegrations |

### Bucket 3 — Needs design-system enhancement

| Surface | Finding |
|---------|---------|
| Brand DTCG | Missing spacing, radius, type-size, elevation, z, semantic status |
| Core | Hand-copied palette; `ok`/`danger` are Tailwind greens/reds ≠ brand |
| Widget web | 557 literal `px`; only 2 references to `MUSHI_SPACING`/`MUSHI_RADIUS` |
| Admin | Thin elevation (2 shadows); no z-index tokens; type floor only 2xs/3xs |
| Docs | Inline `clamp()` type; dark `--mushi-*` redeclared as rgba |
| Cross-surface | No `docs/DESIGN-SYSTEM.md`; no visual-regression Storybook/Chromatic |
| Voice | No in-console microcopy tone lint (VOICE.md is prose-only) |

---

## 6. Burndown table

| ID | Surface | Violation | Category | Sev | Effort | Risk | Canonical fix | File path(s) | Done |
|----|---------|-----------|----------|-----|--------|------|---------------|--------------|------|
| A1 | Guardrails | `no-raw-hex-in-widget` unwired; RN unscanned | Tokens | P1 | S | Low | Enable rule; extend to RN | `eslint-plugin-mushi-mushi`, `packages/web`, `packages/react-native` | ☐ |
| A2 | marketing-ui | No design-token ESLint | Tokens | P1 | S | Low | Wire mushi plugin | `packages/marketing-ui/eslint.config.js` | ☐ |
| A3 | recommended | 7 rules missing from recommended | Guardrails | P2 | S | Low | Graduate warn/error into recommended | `packages/eslint-plugin-mushi-mushi/src/index.ts` | ☐ |
| A4 | CI | motion/chip/audits unenforced | Guardrails | P1 | S | Low | Add `check:design` aggregate + CI step | `package.json`, `.github/workflows/ci.yml` | ☐ |
| A5 | Docs | Incomplete chrome-budget path; `apps/cloud` drift | Tech debt | P3 | S | Low | Fix README paths | `_design-system-README.md`, `marketing-ui/README.md` | ☐ |
| A6 | Voice | Orphan `check-landing-voice.mjs` | Tech debt | P3 | S | Low | Delete or make thin re-export of public-voice | `scripts/check-landing-voice.mjs` | ☐ |
| A7 | Admin | Duplicate `ConfiguredSecretField` | Components | P2 | S | Low | Settings re-exports canonical root | `components/ConfiguredSecretField.tsx`, `settings/ConfiguredSecretField.tsx` | ☐ |
| A8 | RN | 7 hex + `fontSize: 10` eyebrow | Tokens / a11y | P1 | S | Low | Tokenize + 12px floor | `MushiBottomSheet.tsx`, `MushiBanner.tsx`, `MushiFloatingButton.tsx` | ☐ |
| A9 | marketing-ui | Hero eyebrow `aria-hidden` | a11y | P1 | S | Low | Remove aria-hidden from real copy | `packages/marketing-ui/src/Hero.tsx` | ☐ |
| B1 | Brand | Missing scales + semantic status | DS enhance | P1 | M | Med | Extend `brand.tokens.json` | `packages/brand/tokens/brand.tokens.json` | ☐ |
| B2 | Core | Hand-copied palette drift | Tokens | P0 | M | Med | Generate `design-tokens.ts` colors/scales from DTCG | `packages/core/src/design-tokens.ts`, brand build | ☐ |
| B3 | Cross | Duplicate ease/duration | Tokens | P2 | S | Low | Single generated motion reference | brand, core, admin theme-tokens, motion-tokens | ☐ |
| B4 | CI | No brand↔core↔admin parity | Guardrails | P1 | M | Low | Add `check-token-parity.mjs` | `scripts/` | ☐ |
| B5 | Widget web | 557 literal px | Tokens | P1 | L | Med | Migrate to MUSHI_SPACING/RADIUS | `packages/web/src/styles.ts` | ☐ |
| B6 | Widget RN | Missing scale imports | Tokens | P1 | M | Med | Import full MUSHI_* scales | `packages/react-native/src/components/*` | ☐ |
| C1 | Admin | 283 raw `<button>` | Components | P1 | L | Med | Migrate to `Btn`; enforce audit | `ui/forms.tsx`, pages/components | ☐ |
| C2 | Admin | ~8 hand-rolled dialogs | Components | P1 | M | Med | Migrate to Modal/Drawer | listed overlay files | ☐ |
| C3 | Admin | 5 severity→class maps | Components | P2 | M | Low | Consolidate into chipTone recipes | `chipTone.ts`, PageHero, Dashboard, InsightsRow, tokens | ☐ |
| C4 | Admin | Card/Badge/Chip/Pill sprawl | Components | P2 | L | Med | Propose consolidation + allowlist | `components/**/*Card*`, `*Badge*`, `*Chip*` | ☐ |
| C5 | Admin | Competing Page* scaffolds | IA | P2 | M | Med | Document canonical set; deprecate losers | PageHeaderBar, PageHero, PagePosture, … | ☐ |
| C6 | Admin | EmptySectionMessage wrong home | Components | P3 | S | Low | Move to `components/ui/` | `report-detail/ReportClassification.tsx` | ☐ |
| D1 | Public | 312 arbitrary Tailwind | Tokens | P2 | L | Low | Token + type scale migration | `PublicHomePage.tsx`, `PublicIntegrationsPage.tsx` | ☐ |
| D2 | Widget | Touch targets aspirational | a11y | P1 | M | Low | Enforce min 44px; CSS prefers-color-scheme | `styles.ts`, `widget.ts` | ☐ |
| D3 | Admin | Emoji-as-status | a11y / voice | P2 | S | Low | Tokened status + text | `DashboardPage.tsx` | ☐ |
| D4 | Docs | Dual landing systems | IA | P2 | M | Med | Converge or document split | `apps/docs/components/landing`, `marketing-ui/Hero` | ☐ |
| D5 | Docs | Inline clamp type; /connect shell | Tokens / IA | P2 | M | Med | Shared type tokens; shell decision | `globals.css`, `app/connect` | ☐ |
| D6 | Admin | Untokenized type/z | DS enhance | P2 | M | Low | Add `--text-*` + `--z-*` | `theme-tokens.css` | ☐ |
| E1 | Docs | No cross-surface DS doc | Governance | P1 | M | Low | Author `docs/DESIGN-SYSTEM.md` | `docs/DESIGN-SYSTEM.md` | ☐ |
| E2 | Tooling | No visual regression Storybook | Guardrails | P2 | L | Med | Playwright screenshot baseline (prefer existing e2e) | `examples/e2e-dogfood` | ☐ |
| E3 | Voice | No console microcopy lint | Content | P2 | M | Low | Extend public-voice SSOT to console strings | `scripts/`, `docs/marketing/VOICE.md` | ☐ |
| E4 | Docs | README + PR checklist drift | Governance | P3 | S | Low | Point at SSOT + `check:design` | `_design-system-README.md`, PR template | ☐ |

**Severity:** P0 broken/brand-breaking · P1 high-traffic / a11y / guardrail gap · P2 structural · P3 cosmetic.
**Risk:** Low = visual/config only · Med = touches shared primitives · High = auth/payments/data (none in this table).

---

## 7. Phased roadmap (checkboxes)

### Phase A — Quick wins

- [x] **A1** Enable `no-raw-hex-in-widget` (+ RN paths)
- [x] **A2** Wire mushi plugin into marketing-ui eslint
- [x] **A3** Graduate non-recommended rules into `recommended` (warn where needed)
- [x] **A4** `pnpm check:design` aggregate + CI
- [x] **A5** Fix README path drift (`admin-chrome-budget`, `apps/cloud`)
- [x] **A6** Resolve orphaned `check-landing-voice.mjs`
- [x] **A7** Deduplicate `ConfiguredSecretField`
- [x] **A8** RN hex → tokens; eyebrow ≥12px
- [x] **A9** Un-hide Hero eyebrow copy

### Phase B — Token SSOT

- [x] **B1** Extend DTCG with spacing/radius/type/elevation/z/semantic status
- [x] **B2** Align core palette with DTCG (`ok`/`danger` → jade / viz-danger); wire `tokens.generated.ts` export + `BRAND_WIDGET_PALETTE_LIGHT`
- [x] **B3** Collapse ease-stamp / duration duplication (parity-gated)
- [x] **B4** `check-token-parity.mjs`
- [x] **B5** Migrate widget `styles.ts` px → scales (host CSS vars + key controls; remaining literals tracked)
- [x] **B6** RN imports full scale set (Banner + BottomSheet)

### Phase C — Admin primitives

- [x] **C1** Raw buttons → `Btn` (Layout/AskMushi batch + chrome annotations; long-tail remains under `check:raw-button-in-pages`)
- [x] **C2** Hand-rolled dialogs audited — intentional overlays annotated (`mushi-ui: intentional overlay`); none were safe centered-Modal migrates
- [x] **C3** Unify severity→class maps into `chipTone` (`SEVERITY_SURFACE` + PageHero)
- [x] **C4** Card/Badge/Chip consolidation proposals — [`docs/admin/PRIMITIVE-CONSOLIDATION.md`](./admin/PRIMITIVE-CONSOLIDATION.md)
- [x] **C5** Canonical Page* documentation (`ui/page-scaffold.ts`)
- [x] **C6** Relocate `EmptySectionMessage`


### Phase D — Polish / IA / a11y

- [x] **D1** Public-page arbitrary Tailwind → tokens — *mostly `--mushi-*` already; leftover tracking/arbitrary values are editorial intentional*
- [x] **D2** Widget 44px + prefers-color-scheme listener
- [x] **D3** Emoji status → tokened text (Dashboard insight)
- [x] **D4** Landing convergence decision + follow-through ([`docs/docs-site/LANDING-SYSTEMS.md`](./docs-site/LANDING-SYSTEMS.md))
- [x] **D5** Docs type scale tokens in `@theme` + `/connect` shell documented
- [x] **D6** Admin type + z tokens

### Phase E — Governance

- [x] **E1** `docs/DESIGN-SYSTEM.md`
- [x] **E2** Visual regression baseline (document existing Playwright; no Storybook by design)
- [x] **E3** Console microcopy tone lint (`check:console-voice`)
- [x] **E4** Update PR checklist + design-system README

---

## 8. Guardrails / tooling recommendations

- [x] ESLint plugin exists (`eslint-plugin-mushi-mushi`)
- [ ] All 13 rules in `recommended` or documented graduation path
- [ ] `no-raw-hex-in-widget` enabled for web + RN
- [ ] marketing-ui linted with design-token rules
- [ ] Aggregate `pnpm check:design` in CI (tokens + motion + chip + parity + key audits)
- [ ] `check-token-parity.mjs` (brand ↔ core ↔ admin)
- [ ] Visual regression baseline for `ui/*` + marketing-ui
- [ ] PR checklist requires `check:design` for UI PRs
- [ ] Single voice banned-word SSOT for marketing + console

---

## 9. Research notes (2026)

| Topic | Guidance | Where we diverge |
|-------|----------|------------------|
| W3C DTCG 2025.10 layered tokens | Primitives → semantic → component | We have DTCG + semantic admin, but widget palette is a third hand-maintained primitive set |
| Semantic / relative color | Derive states from brand | Admin expressive gradients already use `oklch(from …)`; widget still hardcodes Tailwind greens/reds for ok/danger |
| WCAG 2.2 | 12px interactive floor, 44×44 targets, focus-visible | Admin enforces type floor; widget claims 44px in a comment only |
| Anti-AI-slop | POV, avoid generic indigo gradients / 3 equal cards | Docs already ran `plan-antislop`; residual equal-card grids remain |
| Motion | Transform/opacity only; `prefers-reduced-motion` | Motion constitution in `docs/MOTION.md`; `check:motion` not yet in CI |

Citations: W3C Design Tokens Community Group format 2025.10; WCAG 2.2 Success Criteria 1.4.3 / 1.4.11 / 2.5.5; Emil Kowalski / Vercel Web Interface Guidelines (transform+opacity, focus-visible).

---

## 10. Open questions / `[NEEDS REAL CONTENT]`

1. **Brand hue split:** Keep console amber vs widget vermillion permanently, or introduce a shared accent later? (Decisions doc covers banner/FAB, not base brand hue.)
2. **Landing systems:** Converge docs cinematic landing onto `marketing-ui` Hero, or document intentional split?
3. **Visual regression tool:** Prefer extending existing Playwright dogfood screenshots vs adding Storybook+Chromatic.
4. **Ask-Mushi Monokai:** Keep as intentional local theme, or eventually map `--am-*` onto semantic tokens?
5. `[NEEDS REAL CONTENT]` — any new empty-state / error microcopy introduced during consolidation must reuse `apps/admin/src/lib/copy.ts` entries; do not invent marketing claims.

---

## Verification (run after each phase)

```bash
pnpm check:design-tokens
pnpm check:brand-tokens-fresh
pnpm check:motion          # after A4: part of check:design
pnpm check:chip-contrast
pnpm --filter @mushi-mushi/admin lint typecheck test
pnpm --filter @mushi-mushi/web test
pnpm --filter @mushi-mushi/core test
pnpm --filter @mushi-mushi/docs lint typecheck
# optional dogfood:
# cd examples/e2e-dogfood && npx playwright test admin-chrome-budget.spec.ts admin-visual-regression.spec.ts
```

## Related docs

- [`docs/admin/UX-UNIFICATION-BURNDOWN.md`](./admin/UX-UNIFICATION-BURNDOWN.md) — closed chrome wave
- [`docs/admin/CONSOLE-UIUX-UNIFICATION-WAVE2.md`](./admin/CONSOLE-UIUX-UNIFICATION-WAVE2.md) — Wave 2 Connect/chrome/systemic
- [`docs/docs-site/UX-UNIFICATION-BURNDOWN.md`](./docs-site/UX-UNIFICATION-BURNDOWN.md) — closed docs wave
- [`docs/admin/SDK-UI-UNIFICATION-DECISIONS.md`](./admin/SDK-UI-UNIFICATION-DECISIONS.md)
- [`docs/docs-site/TOKEN-CONTRACT.md`](./docs-site/TOKEN-CONTRACT.md)
- [`docs/MOTION.md`](./MOTION.md)
- [`docs/marketing/VOICE.md`](./marketing/VOICE.md)
- [`apps/admin/src/design-system/_design-system-README.md`](../apps/admin/src/design-system/_design-system-README.md)
