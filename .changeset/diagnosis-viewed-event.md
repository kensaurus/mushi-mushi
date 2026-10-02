---
"@mushi-mushi/core": patch
---

Add `diagnosis_viewed` to the analytics taxonomy: the console event for a diagnosis becoming visible, keyed on `report_id`, `project_id` and `surface`, with `sample: true` for the console test report.
