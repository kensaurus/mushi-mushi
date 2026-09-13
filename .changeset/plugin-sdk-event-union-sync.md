---
"@mushi-mushi/plugin-sdk": minor
---

Sync the public event taxonomy with the server: `MushiEventName` gains `qa_story.recovered` and `linear.issue.updated`, and `KNOWN_EVENTS` (now exported) lists every union member — including `fix.requested`, `qa_story.failed`, `qa_story.passed` and `qa_story.recovered`, which `isKnownEvent()` previously rejected although the type allowed them. `fix.requested` is documented as the event the Mushi fix-worker emits when it hands a report to a cloud agent (`data.fix.externalAgentId` set), and the `reward.*` members are documented as delivered through the Rewards host webhook rather than the marketplace plugin bus. No runtime behaviour changes for existing handlers.
