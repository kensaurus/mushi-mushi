---
'@mushi-mushi/mcp-ci': patch
---

`gates` now judges `dead_handler` and `mock_leak` on real evidence. Pass your ESLint JSON report (`eslint -f json`, made with `eslint-plugin-mushi-mushi`) as the new `eslint-report` input; its no-dead-handler and no-mock-leak findings are sent with the run. A run that asks for those gates without a report fails instead of passing on no findings. `all` no longer lists `crawl` (the server always skipped it; start a crawl with Inventory → Reconcile), an explicit `crawl` is refused with that reason, a skipped gate prints why, and an errored or missing gate result fails the step.
