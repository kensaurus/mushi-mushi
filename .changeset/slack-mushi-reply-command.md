---
"@mushi-mushi/plugin-slack-app": patch
---

The Slack app manifest now lists `/mushi reply <id> <message>`. On hosted Mushi it answers the person who reported the bug, through the same path as the card's "Reply to reporter" button: they see the message word for word in your app, and get an email or push only if they opted in.
