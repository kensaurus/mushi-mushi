---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
---

The floating launcher takes far less room on phones and no longer covers a host's bottom tab bar.

- `trigger: 'edge-tab'` is now a 22×48px tab flush with the screen edge, inside the safe area, with a 44px-wide tap area. It used to draw a 44×88px card. A horizontal `inset` or `anchor` value no longer moves the tab off the edge; it still places the panel.
- On phones (768px wide or less), `trigger: 'auto'` draws the edge tab instead of the 52px round button. Hosts that placed the button themselves (a left or right `anchor` or `inset`, or `draggable`) keep it. Set `mobileTrigger` to choose either way.
- New `avoidFixedBars` (default `true`): the launcher, panel and toasts lift above fixed or sticky elements that touch the bottom of the viewport. The lift is a floor, so an `inset.bottom` or `anchor.bottom` that already clears the bar wins.
- New `tuckOnScroll` (default `true`): the launcher fades while the page scrolls, and the edge tab slides mostly off its edge. It never tucks while focused or while the panel is open. It is ignored when `smartHide.onScroll` is set.
- The edge tab can be dragged up and down its edge, or nudged with the arrow keys, even without `draggable`. The position is saved per site, separately from the FAB position, when a drag ends rather than on every move. `draggable: false` still pins it. Dragging never goes below a detected bottom bar.
- New `dismissible` (default `true`): the report panel offers "Hide the bug button for this visit". It lasts until the tab closes; `Mushi.show()` brings the launcher back.
- The launcher's pulsing dot now stops under `prefers-reduced-motion`.
- Core: the widget config types gain `mobileTrigger`, `avoidFixedBars`, `tuckOnScroll` and `dismissible`, and `MUSHI_GEOMETRY.edgeTabWidth` is now 22 (the drawn width of the tab).
