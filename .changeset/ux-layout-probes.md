---
'@mushi-mushi/ux': minor
---

Two new layout probes. `overlap` finds in-flow siblings drawn on top of each other, and `outgrows` finds buttons and links that stick out of their container, wrap past two lines or cut their own label off. Deliberate overlap is skipped: positioned layers, negative margins (avatar stacks), transforms, grid items placed in one cell and scroll containers. `mushi-ux audit` files them as one finding per page and rule, the agent packet and judge see them, and a run that adds overlapping or oversized boxes is rolled back.
