---
"eslint-plugin-mushi-mushi": patch
---

`no-redundant-border-on-chip-tone` still flags a resting `border-<tone>` stacked on a `CHIP_TONE` recipe. Hover, focus, and active border colours on that same border are the control's state change, so they are no longer flagged.
