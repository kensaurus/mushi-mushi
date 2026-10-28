---
'@mushi-mushi/cli': patch
---

`mushi init` now ends the env step by naming the variables your deployed site needs (never their values), the file that holds them, where to add them on Vercel and Netlify, and that a `NEXT_PUBLIC_` / `VITE_` variable only reaches the site after a redeploy. Lovable and Bolt users are pointed to the script-tag page instead.

`mushi funnel daily` prints Mushi's own daily scorecard for operators: landing page views, signups and activated organizations per day and by `?src=`.
