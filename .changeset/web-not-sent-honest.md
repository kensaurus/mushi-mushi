---
'@mushi-mushi/web': patch
---

The widget no longer says "Sent" when a report never left the device. When the pre-filter, an on-device classifier, `sampleRate`, the host's `beforeSend` or the SDK's own send limiter stops a report, the reporter stays on the report step with their text and attachments and sees a plain "Not sent" line saying why. The submit outcome carries `failureKind: 'blocked'` or `'throttled'` for these cases.
