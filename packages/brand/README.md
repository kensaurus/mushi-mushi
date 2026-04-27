# @mushi-mushi/brand

Shared Mushi Mushi editorial design tokens: washi paper, sumi ink,
vermillion stamp accents, serif display typography, and mono ledger captions.

```css
@import "@mushi-mushi/brand/editorial.css";
```

## Tokens

The light palette is the default; dark tokens are scoped behind an
explicit `[data-mushi-theme="dark"]` selector so dark mode is **opt-in**,
not driven by `prefers-color-scheme`.

| Variable                    | Light                    | Dark (opt-in)            |
| --------------------------- | ------------------------ | ------------------------ |
| `--mushi-paper`             | `#f8f4ed`                | `#0f0e0c`                |
| `--mushi-paper-wash`        | `#efe7da`                | (unchanged)              |
| `--mushi-ink`               | `#0e0d0b`                | `#f2ebdd`                |
| `--mushi-ink-muted`         | `#5c5852`                | `#928b7e`                |
| `--mushi-ink-faint`         | `#9a9489`                | (unchanged)              |
| `--mushi-rule`              | `rgba(14,13,11,0.12)`    | `rgba(242,235,221,0.12)` |
| `--mushi-vermillion`        | `#e03c2c`                | `#ff5a47`                |
| `--mushi-vermillion-wash`   | `rgba(224,60,44,0.08)`   | `rgba(255,90,71,0.12)`   |
| `--mushi-vermillion-ink`    | `#7a1f15`                | `#ffe5e0`                |

Plus three font stacks (`--mushi-font-display`, `--mushi-font-body`,
`--mushi-font-mono`) and one easing curve (`--mushi-ease-stamp`).

## Why opt-in dark mode?

Earlier versions auto-flipped on `prefers-color-scheme: dark`, which
silently dimmed the cloud marketing landing for any visitor whose OS
happened to be in dark mode — undoing the page's editorial-light intent.
Three surfaces want different posture:

- **`apps/cloud`** — editorial-light by design, never flips.
- **`apps/admin`** — drives its own theme via `html[data-theme="…"]`.
- **`packages/web` (SDK widget)** — computes light/dark in JS via
  `matchMedia` so the widget blends with whatever app it's embedded in.

A media-query switch couldn't satisfy all three, so we moved the dark
tokens behind a `[data-mushi-theme="dark"]` selector. Set the attribute
on `<html>` (or any ancestor) when you actually want dark.
