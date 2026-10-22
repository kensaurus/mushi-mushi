---
'@mushi-mushi/mcp': patch
'@mushi-mushi/cli': patch
---

`list_gate_findings` and `mushi audit findings --gate` accept `portfolio_radar_vulns`: known holes in your dependencies and runtime, matched by exact version against OSV.dev (ADR 0038). `get_radar` and `mushi radar show` list the two new rules, `known_vulnerable_dependency` and `runtime_end_of_life`.
