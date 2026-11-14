How I get Cursor to fix bugs nobody reported: an MCP server that hands it the user's screen, console and network

I run nine apps I built with Cursor and Claude Code. For a while the worst part was bugs in code I hadn't written by hand, especially the ones with no stack trace: a button that does nothing, a page that loads blank.

What I ended up building, and what helped:

1. Capture the moment, not just the error. A small report button in the app grabs a screenshot (the reporter sees it and can remove it), the console and network around that moment, and the page URL. Most "it's broken" messages are useless without that.

2. Turn it into a plain-English diagnosis before it reaches the editor: likely cause, the files involved, how to reproduce. A raw "it doesn't work" gives the agent nothing to go on.

3. Let Cursor pull it over MCP instead of copy-paste. The agent reads the report, the diagnosis and the repro steps directly, so nothing gets lost between the bug and the prompt.

4. Don't merge the agent's fix blindly. A second model reads the original report next to the diff and says whether the fix actually fixes it. Over 60 days on my apps it made 1,803 reviews and said "hold" 596 times.

5. Don't wait for users. People pressed the report button 35 times in those 60 days; about 2,050 reports came from automatic checks of the live sites and my own testing.

It's open source and called Mushi Mushi. There's a free check of any live site with no sign-up, if you want to see what it finds on yours: https://kensaur.us/mushi-mushi/docs/check?src=reddit.cursor

What do you give Cursor when a user says "it doesn't work"? I'm curious what context other people found matters.
