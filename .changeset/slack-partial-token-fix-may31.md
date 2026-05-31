---
'@mushi-mushi/server': patch
---

fix(slack): replace partial reporterToken with report ID prefix in Slack messages

The Slack notification block was including the first 12 characters of the
project API key (`reporterToken.slice(0, 12)`) in the context row visible to
everyone in the channel. While the reporterToken is a client-side public key,
partial key values in shared channels are still poor practice.

Replaced with the first 8 characters of the report UUID — enough to correlate
the Slack message with the report in the admin console without exposing any
credential material.
