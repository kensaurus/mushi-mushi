Your users won't tell you it's broken. 5 checks I run on every vibe-coded app after it goes live

I run nine apps I built with AI, each with a "report a problem" button. Over the last 60 days, people pressed it 34 times. In the same 60 days, about 2,000 bug reports came in from automated checks and my own testing. Most people who hit a bug don't report it. They leave.

So these are the checks I now run on anything I ship, before I wait for anyone to complain. Each one takes a couple of minutes.

**1. The page title.** Lovable, Bolt and Vite templates start with titles like "Lovable App" or "Vite + React". That is what shows in Google and in the browser tab. Open your live site and look at the tab. In Lovable, ask: "Set the page title and meta description in index.html to <your app name> and <one sentence>."

**2. Footer and nav links.** The generator happily links "Terms", "Privacy" and "Contact" to pages that don't exist. Click every link in the footer on the live site, not in the preview. A single-page app often shows its own "not found" screen with a 200 status, so you have to look at the page, not the status.

**3. The console on first load.** Open DevTools, go to Console, then hard-reload. Red errors on load usually mean a feature is quietly dead: a missing env var on the host, a Supabase key that only exists locally, a third-party script blocked by the browser.

**4. Images.** In DevTools, go to Network, filter to Img and reload. Anything that comes back 404 is a broken image someone is looking at.

**5. Submit every form once, on production.** Contact, signup, waitlist, checkout. The ones I've seen break: a captcha that never loads, a button that does nothing because the handler points at a preview URL, and a price on one page that doesn't match another ("$$36" is a real one).

The pattern: none of these throw an error a monitoring tool would page you about, and none of them are things a user writes in about. You only find them by looking.

What's on your list? I'm especially curious about checks for auth flows, since that's where I keep finding new ones.
