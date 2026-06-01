---
'@mushi-mushi/web': patch
---

polish(console): PDCA loop microinteractions, loop-back arc, opaque arrows, chart x-axis labels

### Dashboard — PDCA Loop Status canvas

- **Layout changed from diamond to horizontal row** (Plan → Do → Check → Act) for left-to-right reading flow.
- **Act→Plan loop-back arc**: hand-crafted cubic-bezier `M act.bottom C act.bottom+120 plan.bottom+120 plan.bottom` so the return path sweeps 120 px below the node row rather than producing a flat line (the previous `getBezierPath` Bottom→Bottom path with equal source/target Y resolved to zero curvature).
- **Arrow opacity**: all edge main-stroke paths are now `opacity: 1` unconditionally — inactive edges were previously rendered at 88 % which read as transparent at fitView zoom. Track layer raised from 12 % to 22 %, glow layer from 13 % to 22 %.
- **Auto-fit on init**: added `onInit` callback that defers `rf.fitView()` one animation frame. The `fitView` prop fires before edge paths are measured, so without this the loop arc's bounding box was excluded and the view was clipped on first load.
- **Canvas height** raised from 320 → 380 px (live variant) to accommodate the loop arc.
- **Minimap removed** — unnecessary for a fixed 4-node diagram; reclaims ~88 px of vertical canvas.

### Node microinteractions

- Hover: `scale-[1.016]`, `shadow-xl`, `border-edge` — 150 ms ease transition.
- Click press: one-shot `mushi-node-press` keyframe (scale dip to 0.97 then bounce back, 220 ms).
- Focus-stage blink: `mushi-focus-blink` — slow 2.2 s opacity pulse on the ring of the active stage.
- Running glow: dual-layer box-shadow (`inner ring + diffuse ambient`) with `ease-in-out` timing.

### Edge microinteractions

- 16 px transparent SVG hit-area path so the edge is easy to hover/click.
- On hover: track opacity `0.22 → 0.38`, glow opacity `0.22 → 0.42`, glow blur `2.5 → 3.5 px` — all 180 ms ease.
- `LOOP_DEPTH` constant promoted to module scope.

### Report Intake chart (`SeverityStackedBars`)

- **X-axis**: 5 evenly-spaced date tick labels (was only first + last).
- **Y-axis**: max + midpoint + 0 reference lines (was max + 0 only).
- **Value labels**: suppressed when bar < 20 % of max to prevent overlap on dense data.
- **Ghost bars**: zero-report days now show a 4 px dashed placeholder so the grid is visually consistent.
- **Chart height**: raised from `h-24` (96 px) to `h-[7rem]` (112 px) for better vertical resolution.
- **Segment min-height**: each severity span gets `minHeight: 2px` so a 1-report slice of 100-report day is always visible.
- **Hover brightness**: `group-hover:brightness-110` replaces per-segment `opacity-90` — avoids flattening the stacked colours.

### Beta banner

- Lime-green colour scheme (`--color-lime` oklch tokens for both dark and light themes).
- Reduced to `py-0.5` single-line height; action links are flat text separated by `|` dividers (no pill borders).
- Works correctly in both dark and light themes.

### Sidebar mode toggle

- Redesigned from `rounded-full` pill to a `rounded-md` segmented control.
- Active segment: `bg-brand/25 ring-1 ring-brand/20 font-semibold` for clear selection affordance.
- Inactive segments: `hover:bg-surface-overlay hover:text-fg-secondary` micro-interaction.

### PDCA receipt strip

- Long proof strings (file paths, stack traces) no longer overflow the container; wrapped with `[overflow-wrap:anywhere] line-clamp-3` and a `title` tooltip for the full value.
