Show HN: Mushi Mushi – find and fix what broke in your AI-built app

I build apps with AI and run nine of them with real users. The surprise was how rarely people report bugs. In 60 days, 36 reports came through the in-app button, while about 2,040 reports came from automated checks and my own testing.

Mushi Mushi is what I built for that. It's open source (MIT SDKs, AGPLv3 server) and has two ways in:

1. A free check of a live site, with no sign-up: broken links and images, pages that don't load, template titles like "Lovable App", and errors on load. It reads public pages only.

2. A small report button for your users (one script tag, or one prompt in Lovable or Bolt). Each report comes back as a plain-English cause and a fix prompt your AI editor can apply. An MCP server lets Claude Code, Cursor or Lovable pull the report and the fix context directly.

On my own apps, a second model reviews the AI-written fixes before they merge. In 60 days it reviewed 1,803 and held 596.

What's free for one app: the button and the diagnoses (I pay for the model), the one-time site check, and a scan of your dependencies for known vulnerabilities once GitHub is connected. The hourly site watch and the code audits need your own keys or a local agent.

Live numbers: https://kensaur.us/mushi-mushi/docs/proof?src=hn.show
Try the check: https://kensaur.us/mushi-mushi/docs/check?src=hn.show
Code: https://github.com/kensaurus/mushi-mushi

I'd like to hear what the check misses on your site, and whether the plain-English explanations are actually useful or just noise.
