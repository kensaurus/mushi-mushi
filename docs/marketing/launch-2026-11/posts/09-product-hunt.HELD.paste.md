Name: Mushi Mushi

Tagline: One place to improve your AI-built app

Description: Find what breaks, where people get stuck and what the code needs. Each problem comes back in plain English with a fix prompt Lovable, Cursor or Claude Code can apply. Free check of any live site, no sign-up. Open source, free for one app.

Topics: Developer Tools, Open Source, Artificial Intelligence

Website: https://kensaur.us/mushi-mushi/?src=ph.launch

First comment:

Hi Product Hunt, I'm Kenji. I build apps with AI and run nine of them with real users.

What surprised me most was how rarely people tell you something is wrong. In the last 60 days, 35 reports came through the in-app button. About 2,050 came from automatic checks and my own testing. Most people who hit a problem just leave.

Mushi Mushi is what I built for that. It does three things:

1. Finds what breaks. A free check of your live site, with no sign-up: it opens your home page and three pages it links to, like a first visitor would, and tells you what is broken (pages that error or show nothing, dead links and images, a title still saying "Lovable App"). And a small report button for your users: one script tag, or one prompt in Lovable or Bolt. Each report comes back as a plain-English cause and a fix prompt your AI editor can apply.

2. Shows where people get stuck: dead ends, loops and pages people leave from, each with a suggestion.

3. Improves the code: known vulnerable dependencies, code audits and repo clean-up, as draft PRs you review.

An MCP server lets Claude Code and Cursor pull all of it straight into the editor.

The free plan covers one app and 100 diagnoses a month, and I pay for the model. The hourly site watch and the code audits need your own keys or a local agent.

The guide in the screenshots is Field Kenji, a naturalist with a magnifier. He walks you through sign-in, setup and your first diagnosis.

The SDKs are MIT and the server is AGPLv3: https://github.com/kensaurus/mushi-mushi

I'd like to hear what the check misses on your site, and which of the three you'd actually use.
