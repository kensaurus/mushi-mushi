# Tinted-text inventory and readability pass (2026-11-27)

The owner said on 2026-11-27: "bare background color text on many of the uiux — really bad — fix all of them universally in the mushi design system and housekeep it". A second ask the same day: "use color and contrast better … fix could be a red button, triage could be a yellow button … enhance readability".

"Bare tinted text" means words on a flat tint with no edge. It reads as a highlighter stroke, not a component. The examples were Succeeded, Updated now, the Runs / New Run tabs, Ctrl K, the plan tag, Beta, the one-app banner and the sidebar counts.

Where the bare look came from: #1141 (2026-11-16) removed every border from `CHIP_TONE`, `Badge`, `HEADER_BADGE_TONE` and 82 pill strings ("pills are tint only"). [ADR 0071](../adr/0071-chips-have-an-edge-and-actions-take-an-intent-colour.md) records that this is partly reversed. The edge comes back as a 1px inset ring, so nothing grows.

The scanner is `scripts/audit-tinted-text.mjs` (`pnpm check:tinted-text`, also in `lint:tokens` and `check:design`). It counts class strings that put a text colour on a tinted fill with no border, ring or outline at rest:

- semantic tints: `bg-<tone>-muted`, `bg-<tone>-subtle`, and opacity tints under 70 % (`bg-ok/15`);
- signal-kit soft fills;
- chip-shaped `bg-surface-overlay`.

It does not count non-text fills such as dots, stripes, bars and skeletons.

## 1. Inventory: before and after

### Source recipes: the root cause

On `origin/master` every shared recipe was a fill with no edge, so every use of one was bare tinted text.

| Recipe | Uses on master | After |
| --- | --- | --- |
| `CHIP_TONE.*` (13 keys) | 557 refs, 149 files | 8 keys, each `fill + ink + inset-ring inset-ring-<tone>-edge` |
| `*Subtle` / `brandSubtle` (60 % alpha twins) | 694 refs | Folded into the solid tone (codemod). Keys removed. |
| `HEADER_BADGE_TONE` | 16 | Removed → `CHIP_TONE.neutral` |
| `META_CHIP_TONE` (alias) | 8 | Removed → `CHIP_TONE` |
| `SEVERITY_TRAFFIC_BADGE` | 14 | Removed → `severityChipTone()` / `SeverityPill` |
| `RESULT_CHIP_CLS` (hand-mixed alphas) | 5 tones | Routed to `CHIP_TONE` |
| `Badge` (`px-1 py-px rounded-xs`, no edge) | 318 call sites | Shape fixed at the source. Defaults to `neutral` when no `bg-*` is passed. 45 `className={CHIP_TONE.x}` became `tone="x"`. |
| `statusChipTone` / `runStatusChipTone` / `prStateChipTone` | 63 | Same names, edged tones |

### Hand-rolled class strings (scanner)

| Pattern | master | after |
| --- | --- | --- |
| semantic-chip (tinted chip, no edge) | 14 | 0 (1 allowlisted: hotkeys `<mark>`) |
| semantic-banner (tinted block or tone fragment, no edge) | 16 | 0 |
| neutral-chip (grey chip fill, no edge) | 55 | 0 |
| inline-style background + colour | 10 | 0 (10 allowlisted, see below) |
| tone fragments with a border colour but no border width (strict pass) | 8 | 0 |
| **Total** | **103 in 51 files** | **0** |

Files on master, by count:

| Count | Files |
| --- | --- |
| 8 | `components/skill-pipeline/skillCategoryMeta.ts` |
| 6 | `components/rewards/tabs/panels.tsx`, `components/sdk-install/SdkInstallPreview.tsx` |
| 5 | `components/SdkNativeConnectivityCard.tsx` |
| 4 | `report-detail/ReportEvidence.tsx`, `reports/ReportRowSummaryMeta.tsx`, `signal/HeatGrid.tsx` |
| 3 | `PageHelpPanel.tsx`, `report-detail/ReportBranchGraph.tsx`, `SdkHealthPanel.tsx`, `design/DirectionPhoneMock.tsx` |
| 2 | `design/DesignChangePreview.tsx`, `explore/ExploreSymbolPanel.tsx`, `FixProgressStream.tsx`, `hero-flow/OperatorTraceLog.tsx`, `ops/OpsKeyRow.tsx`, `pages/McpAuthPage.tsx` |
| 1 | `billing/PlanComparisonTable`, `ci/CiSummary`, `ci/CiTimeline`, `cost/CostDisplayChips`, `DangerConfirm`, `FixGitGraph`, `graph/GraphSidePanel`, `HelpRichText`, `hero-flow/HeroNodes`, `home/HowThisWorks`, `HotkeysModal`, `inventory/ProposalReviewModal`, `mcp/McpCatalogPanel`, `pipeline/WorkerLaneCard`, `PlanBadge`, `ProjectCreatedSuccessPanel`, `ProjectHeartbeatStrip`, `projects/ProjectsListPanel`, `report-detail/AgentTracePanel`, `report-detail/ReportClassification`, `report-detail/ReportPdcaStory`, `report-detail/ReportSurface`, `reports/BreadcrumbPeek`, `reports/DispatchFixPreflight`, `reports/ReportRowView`, `ui/misc`, `ux-runs/UxStartRunCard`, `pages/AntiGamingPage`, `pages/FixesPage`, `pages/OnboardingPage`, `pages/OrganizationSettingsPage`, `pages/QaCoveragePage`, `pages/ReportDetailPage`, `fixes/FixStageNode` |
| strict pass | `reports/reportRowAttribution.ts` (7), `ui/misc.tsx` ResultChip info (1) |

A scripted codemod moved 75 strings to `${CHIP_TONE.<tone>}`, and each was then reviewed; one, the hotkeys search `<mark>`, was reverted and allowlisted. The rest were edited by hand.

### Justified exceptions (allowlisted, with the reason on the line)

The gate is strict: only a width counts as an edge (`border`, `ring`, `inset-ring`, `outline`). A border colour alone does not.

| file:line (`apps/admin/src/…`) | Why it stays as it is |
| --- | --- |
| `components/signal/HeatGrid.tsx:60-63` | A heat cell's fill is the data, as in a table heat map |
| `components/design/DesignChangePreview.tsx:18-19` | Full-width diff-line wash, not a chip |
| `components/design/DirectionPhoneMock.tsx:71, 83, 136` (inline styles) | Renders the host app's own palette (a design-direction mock) |
| `components/sdk-install/SdkInstallPreview.tsx:96, 153, 165, 262, 292, 331` (inline styles) | Preview of the host's widget in the host's colours |
| `components/fixes/FixStageNode.tsx:48` (inline style) | Per-stage hue from `STAGE_HEX`; the tile now has its own 1px inset edge in that hue |
| `components/HotkeysModal.tsx:317` (search-match `<mark>`) | A search-match highlight is meant to look like a highlighter |
| `components/signal/Chip.tsx:16` | Tone fragment; the Chip root adds `border` |
| `components/ui/layout.tsx:397-399` (`HELP_BANNER_TONE`) | Tone fragment; HelpBanner adds `border` |
| `lib/tokens.ts:215-217` (`SEMANTIC_BANNER_TONE`) | Tone fragment; its one caller (HomeSectionBody) adds `border` |
| `pages/LoginPage.tsx:493` | The passkey button is a `Btn variant="ghost"`, which supplies the border width |

## 2. The primitives (one set)

| Primitive | Where | What it draws |
| --- | --- | --- |
| `CHIP_TONE` tones `ok · warn · danger · info · accent · brand · medium · neutral` | `lib/chipTone.ts` | Tint + `*-foreground` ink + `inset-ring inset-ring-<tone>-edge` |
| `Badge` (also the plan and Beta tag) | `components/ui/layout.tsx` | 12px semibold, `px-1.5 py-px`, `rounded-sm`, a tone, an optional `icon` |
| `SeverityPill` | `components/ui/layout.tsx` | ▲ Critical / ◆ High / ● Medium / ○ Low, glyph and word in the severity tone (WCAG 1.4.1) |
| `CountBadge` | `components/ui/layout.tsx` | Rounded count, 99+ cap, tone; sidebar counts and health counts |
| `StatusPill` (signal kit, unchanged) | `components/signal/StatusMark.tsx` | Run state: glyph, colour, edge. Iterate's Succeeded now uses it. |
| `Kbd` | `components/ui/misc.tsx` | Key cap: raised surface, `neutral-edge`, 2px bottom edge |
| `SegmentedControl` | `components/ui/forms.tsx` | The selected segment is a raised `segment-active` tile with an accent inset edge and a card shadow on a sunken `segment-track`. It is not an accent wash. |
| `Callout` | `components/ui/fields.tsx` | Tinted panel, full tone edge, 2px leading bar, a default tone icon (info i, ok ✓, warn/danger ▲) |
| `FreshnessPill` | `components/ui/layout.tsx` | Edge is `neutral-edge` (3.5–4.3:1). `edge-subtle` was 1.9:1, so it looked borderless. |
| `Btn intent` + `btnClassName()` | `components/ui/forms.tsx`, `lib/actionIntent.ts` | `fix` solid red, `triage` solid amber with dark ink, `primary` brand, `neutral` ghost, `destructive` red confirm |

New tokens are defined in both themes. High contrast inherits the dark values.

- `--color-{ok,warn,danger,info,accent,brand,neutral,sev-medium}-edge`
- `--color-warn-fill`, `--color-warn-fill-fg`
- `--color-sev-medium-muted`, `--color-sev-medium-foreground`
- `--color-segment-track`, `--color-segment-active`

### Intent → colour map (shipped)

| Intent | Button | Same hue as | Dark ink/fill | Light ink/fill |
| --- | --- | --- | --- | --- |
| `fix` (Fix →, Dispatch fix in the Bugs list) | `bg-danger text-danger-fg` + `ring-danger-edge` | Critical chip | 7.31:1 | 6.84:1 |
| `triage` (Triage →) | `bg-warn-fill text-warn-fill-fg` + `ring-warn-edge` (dark ink on amber) | High chip | 8.87:1 | 9.16:1 |
| `primary` (Open backlog, Open the worst, Save) | brand gradient (unchanged) | — | — | — |
| `neutral` (View on closed rows, secondary) | ghost (unchanged) | — | — | — |
| `destructive` (Delete, Revoke confirm) | red confirm (unchanged), never a row action | — | — | — |

Coverage today: the Bugs list (table rows, phone cards and the Fix preflight trigger). Other pages keep their existing `Btn` variants; new row actions should pass `intent`.

`reportRowIntent(status)` maps a report row to its intent. Classified or fixing → fix. New → triage. Fixed, verified, resolved or dismissed → neutral.

Bug detail keeps "Copy fix prompt" as its one primary action ([ADR 0069](../adr/0069-builder-console-is-the-fix-loop.md)), so its Dispatch stays secondary.

## 3. Readability: Bugs (`/reports`)

These are CSS estimates, not measurements on a rendered page: the playwright-cli browser tool isn't installed on this PC, and this branch is not deployed. They come from the token values and the Tailwind scale, at a 1440px viewport with the sidebar open, which leaves the summary column about 826px wide. They assume an average Latin glyph of about 0.5em (Inter) and 1em for CJK, with `ch` ≈ 0.62em.

### Text measurement

| Surface | px | Line-height | CPL | Contrast (dark / light) | vs threshold |
| --- | --- | --- | --- | --- | --- |
| Row title, before | 14 / 500 | 1.375 (`leading-snug`) | ≈ 118 Latin / ≈ 59 CJK (≈ 826px column) | 14.3 / 19.9 | line-height < 1.4 ✗; CPL > 80 / > 40 ✗ |
| Row title, after | 14 / 500 | 1.5 | ≤ 65ch ≈ 80 Latin / ≈ 40 CJK (`max-w-prose`), 2-line clamp, full text in `title` | 14.3 / 19.9 | ✓ |
| Technical subtext, before | 12 | 1.375 | ≈ 140 | 6.56 / 9.21 (`fg-faint`) | AA ✓; px < 14 ✗ |
| Technical subtext, after | 12 | 1.5 | ≤ 65ch | 7.87 / 12.68 (`fg-muted`) | AA ✓; px < 14 kept (see note) |
| Meta chips (source · app · path) | 12 / 500 | 1.25 (single line) | — | 8.44 / 13.02 | AA ✓ |
| Severity pill (Crit/High/Med/Low) | 12 / 600 | 1.25 | — | 6.2–9.0 / 6.1–8.7 | AA ✓ |
| Low-confidence chip | 12 / 600 | 1.25 | — | 8.03 / 7.46 | AA ✓ |
| Row action, before | 12 (`text-3xs`), 20px high | 1 | — | brand fill | 24px target ✗ |
| Row action, after | 12, 24px high (`Btn sm`) | — | — | Fix 7.3 / 6.8 · Triage 8.9 / 9.2 | ✓ |

Note: the 14px target for dense tables is met by the row title. Meta and chip text stays at the console's 12px floor. That is a deliberate exception: on 2026-11-16 (#1141) the owner made 12px the floor and asked that nothing else grow ("keep it informationally dense"). DESIGN-SYSTEM "Stay dense" says the same. Raising `--text-2xs` would move about 1,550 call sites.

### Channel findings

| Channel | Principle | Load type | Severity | Fix |
| --- | --- | --- | --- | --- |
| Colour: chips, tags and pills with no edge | Figure/ground; WCAG 1.4.11 | Perceptual | High | Inset tone edge on every `CHIP_TONE` recipe |
| Colour: severity shown by tint only | WCAG 1.4.1 (use of colour) | Perceptual | High | `SeverityPill` glyph + word |
| Colour: every row action the same grey or black pill | Von Restorff; intent mapping | Cognitive (decision) | Medium | Fix red, Triage amber, View neutral |
| Selected tab is tinted text | Signifiers (affordance) | Perceptual | Medium | Raised tile + accent edge |
| Row title line length ≈ 118 CPL | Readable measure (≤ 80 / ≤ 40 CJK) | Reading | Medium | `max-w-prose` + 2-line clamp |
| Row title line-height 1.375 | Dense-table leading 1.4–1.6 | Reading | Low | `leading-normal` (1.5) |
| Rows run together (8px padding, 2px gap) | Gestalt proximity | Perceptual | Low | 10px row padding, 4px title→meta gap |
| 20px row action | Fitts; WCAG 2.5.8 (24px) | Motor | Medium | `Btn size="sm"` (24px, 32px coarse) |
| Kbd, freshness and track edges 1.9:1 (`edge-subtle`) | WCAG 1.4.11 | Perceptual | Low | `neutral-edge` (3.5–4.3:1) |
| Confidence shown as tinted words | Recognition over recall | Cognitive | Low | Warn badge with a labelled `role="meter"` bar |

### Fixes applied

| Before | After |
| --- | --- |
| `Triage →` 20px ink pill; `Fix →` brand wash | `Btn intent="triage"` amber with dark ink; `intent="fix"` solid red |
| Severity: 4-segment strip + tinted "Crit" | `SeverityPill` "▲ Crit" in the Fix red, "◆ High" in the Triage amber |
| "Low confidence · 58%" tinted text | Warn badge + 24px meter + the same words |
| Title 1.375 leading, no measure | 1.5 leading, ≤ 65ch, 2-line clamp |
| Subtext `fg-faint` | `fg-muted` (one step stronger, same size) |
| Row `py-2`, `space-y-0.5` | `py-2.5`, `space-y-1` |
| Severity column 52px | 68px (fits "▲ Crit"); table floor 53.5 → 54.5rem |

## 4. Contrast proof

`packages/server/src/__tests__/console-tone-contrast.test.ts` reads the `CHIP_TONE` recipes from `chipTone.ts` and the Btn and segment recipes from `forms.tsx`. It takes the token values from both admin stylesheets, plus high contrast, and asserts:

- ink on fill ≥ 4.5:1 and edge ≥ 3:1 on surface, raised and overlay for all 8 tones in dark, light and high contrast;
- Fix and Triage ink ≥ 4.5:1, with Triage ink darker than its fill;
- the selected segment label ≥ 4.5:1 and its edge ≥ 3:1 on the track;
- `fg-secondary`, `fg-muted` and `fg-faint` ≥ 4.5:1 on every surface.

It also asserts that no recipe uses `ring-inset`, which would turn focus rings inward. That is 61 cases.
