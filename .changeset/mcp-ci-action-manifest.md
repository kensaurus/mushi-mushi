---
'@mushi-mushi/mcp-ci': patch
---

`action.yml` now declares every input and output the Action uses: the `spec-drift` inputs (`base-spec`, `head-spec`, `fail-on-breaking`) and the `findings`, `ready_to_propose`, `total_events`, `route_count` and `proposal_id` outputs, so GitHub no longer warns about unexpected inputs and workflows can read the outputs. The command list and the unknown-command error now include `spec-drift`.
