# 0071. Console chips have an edge, and row actions take an intent colour

Status: Accepted 2026-11-27. The owner asked for the change and accepted
it ("approved on all lines").
Date: 2026-11-27

Related:
- Code: `apps/admin/src/lib/chipTone.ts` (`CHIP_TONE`, `SEVERITY_TONE`),
  `apps/admin/src/lib/actionIntent.ts`, `apps/admin/src/components/ui/`
  (`Badge`, `SeverityPill`, `CountBadge`, `Kbd`, `SegmentedControl`,
  `Callout`, `Btn intent`).
- Docs: `docs/DESIGN-SYSTEM.md` ("Red means a failure"),
  `docs/design/tinted-text-inventory-2026-11-27.md`.
- Earlier change: #1141 (2026-11-16), which this partly reverses.

## Context

On 2026-11-16 (#1141) the owner said the console was hard to read and "AI
sloppy", and asked to "stop making big, outdated, bloated containers and
pills". The pass that followed made every pill "tint only". It removed the
border from `CHIP_TONE`, `Badge`, `HEADER_BADGE_TONE` and 82 hand-written
pill strings.

Eleven days later, on 2026-11-27, the owner said the opposite was now wrong:
"bare background color text on many of the uiux — really bad — fix all of
them universally in the mushi design system". The examples were the
Succeeded status, the "Updated now" pill, the Runs / New Run tabs, Ctrl K,
the plan tag, Beta, the one-app banner and the sidebar counts. A tint with no
edge reads as a highlighter stroke, not a component. In light mode,
`edge-subtle` sits at 1.9:1, so even the chips that kept a border looked bare.

In the same message the owner asked for colour that means something: "fix
could be a red button, triage could be a yellow button". Every row action on
Bugs was the same grey or ink pill, and severity was small tinted text.

DESIGN-SYSTEM.md held a rule since 2026-11-18: "Red means a failure, nothing
else." A red Fix button breaks that rule as written.

## Decision

1. **A chip is a fill, an ink and an edge.** Every `CHIP_TONE` tone is a
   tinted fill, its `*-foreground` ink and `inset-ring
   inset-ring-<tone>-edge`.
   - Each edge token is at least 3:1 on surface, raised and overlay.
   - The ring is inset, so no chip grows. The #1141 density rule (12px floor,
     `py-px`, no bigger pills) stands.
   - `Badge`, `SeverityPill`, `CountBadge`, `Callout`, `Kbd`, `FreshnessPill`
     and the selected segment all take their shape from this.
   - `pnpm check:tinted-text` fails on a tinted fill with text and no edge.
2. **One tone scale.**
   - Removed: the 60 % alpha `*Subtle` twins, `brandSubtle`,
     `HEADER_BADGE_TONE`, `META_CHIP_TONE`, `SEVERITY_TRAFFIC_BADGE`, and
     `ResultChip`'s private alphas.
   - The tones are ok, warn, danger, info, accent, brand, medium and neutral.
3. **Severity is a glyph and a word in its tone.** ▲ Critical (danger),
   ◆ High (warn), ● Medium (medium), ○ Low (ok).
4. **Row and inline actions take an intent, not a class string.** `Btn
   intent` and `btnClassName({ intent })` map:
   - `fix` → solid danger red;
   - `triage` → solid amber with dark ink;
   - `primary` → brand;
   - `neutral` → ghost;
   - `destructive` → red confirm.

   The hues are the severity hues, so a Critical bug's chip and its Fix button
   are the same red. White on yellow fails AA, so Triage ink is dark.
5. **DESIGN-SYSTEM rule amended:** red means a failure, *or the action that
   fixes one* (Fix, Dispatch fix). Red on anything else is still a bug.
   Selection stays the violet accent, now as an edge on a raised tile instead
   of a wash.

## Consequences

- Chips read as components in both themes, and nothing changed size.
- One scale means one contrast proof:
  `packages/server/src/__tests__/console-tone-contrast.test.ts` reads the
  recipes and tokens and checks every tone in dark, light and high contrast.
- `*Subtle` call sites now paint the full muted fill, slightly stronger than
  before. That is deliberate: an alpha fill's contrast depends on what sits
  under it.
- Bug detail keeps "Copy fix prompt" as its one primary action (ADR 0069), so
  its Dispatch stays secondary. Only list and row actions take the Fix red.

## Rejected

- **Bumping `--color-edge-subtle` globally.** It is every hairline divider in
  the app. Chips get their own tone edges instead.
- **Restoring `border`.** A border adds 2px to every chip, the growth #1141
  removed.
- **`ring-1 ring-inset`.** It sets `--tw-ring-inset`, which every
  `focus-visible:ring-2` focus ring on the same element also reads, so focus
  rings on chip-toned buttons would be drawn inward. The edge uses Tailwind's
  separate `inset-ring` layer.
- **Triage in white on the light-theme warn (L 0.50).** It passes AA but
  reads olive, not amber. `warn-fill` is a brighter amber with dark ink
  (9.2:1).
- **A separate red only for Fix.** The point is that the Fix colour matches
  the Critical colour, so it reuses `danger`.
