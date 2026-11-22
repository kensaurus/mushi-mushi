---
"@mushi-mushi/web": patch
---

- **Closing the panel mid-screenshot sends nothing.** Thanks to [PeepSo](https://peepso.com), whose question led to these tests. With a host `screenshotProvider` the panel stays on screen while it captures, so the reporter can close it before the capture returns. The late screenshot then went out unseen with their next report, and a Send pressed in the closed panel could still post whatever they had started typing after reopening it. Every report now opens with no screenshot attached, a capture that lands after its panel closed (automatic, button, tab share or Mark up) is thrown away, and a Send from a closed panel stops there.
