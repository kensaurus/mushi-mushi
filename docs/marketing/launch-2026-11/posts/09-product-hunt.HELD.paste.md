Name: Mushi Mushi

Tagline: Find out why your AI-built app broke, in plain English

Description: Your users tap a button to report a bug, and Mushi Mushi checks your live site too. Each report comes back as a plain-English cause and a fix prompt that Lovable, Cursor or Claude Code can apply. Open source, free for one app.

Topics: Developer Tools, Open Source, Artificial Intelligence

Website: https://kensaur.us/mushi-mushi/?src=ph.launch

First comment:

Hi Product Hunt, I'm Kenji. I build apps with AI and run nine of them with real users.

What surprised me most was how rarely people report bugs. In the last 60 days, 36 reports came through the in-app button. About 2,040 came from automatic checks and my own testing. Most people who hit a bug just leave.

Mushi Mushi is what I built for that:

1. A free check of your live site, with no sign-up. It opens your home page and three pages it links to, like a first visitor would, and tells you what is broken: pages that error or show nothing, dead links and images, a title still saying "Lovable App". It reads public pages only.

2. A small report button for your users: one script tag, or one prompt in Lovable or Bolt. Each report comes back as a plain-English cause and a fix prompt your AI editor can apply. An MCP server lets Claude Code and Cursor pull the report and the fix context directly.

The free plan covers one app and 100 diagnoses a month, and I pay for the model. The hourly site watch and the code audits need your own keys or a local agent.

The guide in the screenshots is Field Kenji, a naturalist with a magnifier. He walks you through sign-in, setup and your first diagnosis.

The SDKs are MIT and the server is AGPLv3: https://github.com/kensaurus/mushi-mushi

I'd like to hear what the check misses on your site, and whether the plain-English explanations help or just add noise.
