---
'@mushi-mushi/cli': patch
---

`mushi audit` now lists which inventory gates (crawl, status claims, API contract, orphan endpoints, unknown calls) the audit started again, and for each gate it did not re-run, why: it ran in the last day, there is no current inventory, no crawlable URL, the plan does not include it, or a rate limit.
