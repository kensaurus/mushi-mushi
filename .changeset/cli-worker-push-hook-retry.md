---
'@mushi-mushi/cli': patch
---

The local worker runs a failed pre-push hook once more on the same commit before giving up, so a test that timed out while several agents shared the machine no longer throws a good fix away. When a hook does refuse the change, the run's detail names the steps that failed and their own error lines (for example `test: FAIL lib/queries.test.ts …`) instead of the end of the hook's summary.
