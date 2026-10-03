---
"@mushi-mushi/cli": minor
---

`mushi recipe check` now runs Mushi's own design deviance rules (`off_token_color`, `off_token_font`, `off_scale_spacing`, `off_scale_radius`, `contrast_below_aa`, `raw_interactive_element`) over your tracked files and prints the same findings and 0–100 score the console shows. Add `--max-score <n>` to fail the step above a fixed score. With `--push`, Mushi scores the scan itself and the step fails when the project has turned on "fail the CI check" and the score is above its threshold.
