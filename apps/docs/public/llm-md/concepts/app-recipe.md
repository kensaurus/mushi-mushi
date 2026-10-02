# App recipe and design system

Source: https://kensaur.us/mushi-mushi/docs/concepts/app-recipe

---
title: 'App recipe and design system'
description: The App Recipe records what your app is made of, so a diagnosis can say what changed and a fix can respect your design system.
---

# App recipe and design system

Mushi keeps a **recipe** for each app: what it is made of, where each part comes
from, and where reality has drifted from what the app declares. The recipe is
diagnosis context. A report that says *"this button uses a colour that is not in
your tokens"* or *"the fix merged but CI on `main` has failed since"* is cheaper to
fix than a stack trace alone. Every part is optional and shows **not connected**
until you connect it.

The recipe is Plan 019 (ADR 0016). Phase 1 shows the recipe from data Mushi already
has. Phase 1b adds the design plane: your design tokens, a deviance check, and
token or rule edits that open a **draft** pull request.

---

## The five states

Every recipe element is in exactly one state:

| State | Meaning |
|---|---|
| `ok` | Checked recently and nothing is off. |
| `drift` | Checked, and something differs from what the app declares. |
| `unknown` | Configured, but never checked, or the last check is too old. **Never shown as healthy.** |
| `not_connected` | Nothing is configured. Each card says what to connect. |
| `error` | The last check failed. Mushi says why instead of showing an old result. |

The console's **Recipe** page (`/recipe`) shows the eight elements (schema, design
system, routes and stories, gates, CI/CD, deploy, env names, integrations) on one
canvas, with a list view on narrow screens. MCP clients read the same data with
`get_app_recipe`.

## `mushi.recipe.json`

A `mushi.recipe.json` file at your repo root points Mushi at your design tokens.
Tokens use the [W3C DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/)
format. Mushi also reads the shorthand most repos already ship (`"#abc"`,
`"16px"`, flat `"color.bg"` names) and lists each non-conformance as an info note.

```json
{
  "version": 1,
  "design": {
    "tokens": [
      { "path": "tokens/directions/indigo/primitive.tokens.json", "role": "source" },
      { "path": "tokens/directions/indigo/semantic.tokens.json", "role": "source" },
      { "path": "tokens/dtcg/tokens.json", "role": "export", "generator": "npm run tokens" }
    ],
    "components": { "globs": ["design-system/primitives/**/*.tsx"] },
    "literalScan": { "globs": ["app/**/*.{ts,tsx,css}"], "ignore": ["**/*.test.*"] },
    "contrast": [
      { "fg": "color.text.primary", "bg": "color.surface.base", "use": "body text" },
      { "fg": "color.action.primary", "bg": "color.surface.raised", "large": true }
    ],
    "rules": {
      "off_scale_radius": { "severity": "warn", "allowValues": ["50%"] },
      "raw_interactive_element": { "enabled": true, "primitives": { "button": "Button" } }
    }
  },
  "change": { "allowPaths": ["mushi.recipe.json", "tokens/**"] }
}
```

- `role: "source"` files are hand-authored; `role: "export"` files are generated and never edited by Mushi.
- Sibling folders under the same `directions/` parent appear as alternative directions next to the active one.
- `design.contrast` declares the foreground/background pairs that must meet WCAG: 4.5:1 by default, 3:1 with `large: true`, or an explicit `min`.
- `design.rules` turns rules on or off and sets severity, allowed values and ignored files.
- `change.allowPaths` is the only set of paths a recipe pull request may write.
- `design.directions[]` (`{name, status: "active" | "inactive", tokens[], note?}`) lists candidate directions for comparison.
  - `design.tokens[]` stays the only source the drift check reads.
  - At most one direction may be `active`, and its `tokens` must be exactly the `role: "source"` paths. Anything else is rejected with `directions_active_mismatch`.
  - Inactive directions are read-only. They never raise findings, and no recipe pull request edits them in place.
- `design.css[].scopes` names the selectors whose custom properties count, besides `:root` and `@theme`.
  - A light/dark mode written as a scoped selector (`html.dark:root[…]`) is read as its own scope.
  - Variables under an undeclared selector produce an info note (`css_vars_in_undeclared_scope`).

The file is capped at 64 KB, scanned for secrets, and treated as untrusted input.

## The design system page

The console's **Design system** page (`/design`) shows:

- colour swatches, with the computed contrast ratio for every declared pair;
- the type scale, with a Thai and a Latin sample;
- the spacing, radius and motion scales;
- the component inventory.

**Editing a token** opens a draft pull request that changes only your source token
file. Editing a rule opens one that changes only `mushi.recipe.json`. The pull
request stays a draft, so your CI does not run until you mark it ready. Mushi never
writes to your default branch, to workflow files, lockfiles, env files or generated
exports.

### Directions

If your token files live in `directions//` folders, the **Directions** view
shows every direction side by side. Each card has:

- the direction's name and concept;
- its palette, with the declared contrast pairs computed for that direction;
- a type specimen in the declared fonts and in your app's script;
- its line and motion tokens;
- the images found in the direction's folder;
- a phone mock of one screen, drawn only from that direction's tokens;
- the deviance score, for the active direction only.

A direction's name and concept come from the token files themselves: either
`$extensions["us.kensaur.mushi"].direction = {name, nativeName, concept}` or a
root `$description` such as `"… art direction Soi Signpaint (ป้ายเขียนมือ): …"`.

There are two actions:

- **Set active direction** opens a draft pull request that points the `source`
  entries in `mushi.recipe.json` at another direction's files.
- **Duplicate / edit direction** opens a draft pull request that adds a new
  `directions//` folder, copied from an existing direction, with your
  edits applied to the copy.

Images load through short-lived signed links. Mushi serves only images that the
latest snapshot lists.

## The deviance check

The deviance check (gate `design_drift`) reads your source at the latest commit,
up to 1,500 files and 12 MB, and flags values that bypass your design system:

| Rule | Flags | Default severity |
|---|---|---|
| `off_token_color` | Hex, `rgb()`, `hsl()`, `hwb()`, `oklab()`, `oklch()` literals and Tailwind arbitrary values (`bg-[#123456]`) that match no colour token | warn |
| `off_token_font` | Font families not named by any font token | warn |
| `off_scale_spacing` | Padding, margin and gap values off your space scale | info |
| `off_scale_radius` | Border radii off your radius scale | info |
| `contrast_below_aa` | Declared pairs below their required ratio | error |
| `raw_interactive_element` | ``, ``, ``, `` outside your component globs (opt-in) | info |

Comments are ignored. Each finding names the file and line, the value, and the
nearest token, with its CSS variable or TS name.

### The deviance score

The score runs from 0 (fully on your system) to 100 (fully off it), and the same
inputs always give the same number:

1. For each literal rule: `density = findings per 1,000 scanned lines`, and
   `penalty = 1 − e^(−density / 3)`.
2. For the contrast rule: `penalty = failing pairs ÷ declared pairs`.
3. Each rule's weight comes from its configured severity: error 3, warn 2, info 1.
4. `score = round(100 × Σ weight × penalty ÷ Σ weight)`, over the enabled rules
   that have something to judge. A rule with no matching tokens (no radius scale,
   no declared pairs) is left out instead of counting as clean.

If nothing could be judged, the score is **not scored**, never 0. The
**Design system** page charts the score for each run, and the
`design.deviance_score` metric records it.

**Converging on the system.** Tightening a rule (enabling it, raising its
severity, shrinking its allowlist) raises the score at first. Fixing the findings
it reveals brings the score back down, against a stricter system each time.

## In your editor

| MCP tool | Returns |
|---|---|
| `get_app_recipe` | Every element with its state and reason |
| `get_design_tokens` | The normalized tokens and a CSS-variable / TS-name map, so a fix uses tokens instead of literals |
| `get_design_deviance` | The score, the per-rule breakdown, the trend and the top findings |
| `get_fix_context` | Now includes a `recipe` block (at most 4 KB) with the tokens to use |
