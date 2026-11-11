# Starter template: a Lovable / Vite app with the Mushi Mushi button already in

**Status:** plan and exact files. No repo or Lovable project has been created.
**Play:** research note §4 play 10 (low confidence). Build it in week 4 only if
week 3's data says check visitors want a head start (see `../PLAN.md`).
**Tag:** `starter.lovable`

## What it is

A small, real waitlist page that passes the free Production Check on day one:

- a real title;
- no dead footer links;
- a real 404 page;
- no console errors;
- the Mushi Mushi report button wired in.

A builder remixes it in Lovable, or clones it for Bolt or Cursor, then pastes
their own project id and key.

It shows by example what the check looks for. That is the point: the template
is a working answer to the check.

## Two ways to ship it (owner picks one)

| Route | How | Owner time | Note |
|---|---|---|---|
| **A. Lovable project + remix link** | Create a new Lovable project with the build prompt below. Check it, publish it, then turn on remixing in the project settings and copy the remix link. | about 20 minutes | Best fit for the buyer. The remix link is the asset. `[unverified]`: the current name and location of Lovable's remix setting; check in the editor. |
| **B. Public GitHub repo** `kensaurus/mushi-mushi-starter` | Create the repo with the files below; Bolt and Cursor users clone it. | about 15 minutes | Also lets Lovable users connect it through Lovable's GitHub sync. |

Either way, link it from `apps/docs/content/quickstart/lovable-bolt.mdx`. That
file is outside this lane: the patch is one line under "Get your script tag":
"Starting fresh? Remix the starter: <link>".

## Lovable build prompt (route A)

Paste this as the first message of a new Lovable project:

```text
Build a one-page waitlist site for a product called "Your App".
- index.html <title> is "Your App: join the waitlist" and the meta description is one sentence about the product. Never "Lovable App".
- Hero with a heading, one sentence and an email field with a "Join the waitlist" button. On submit, show "Thanks, you're on the list" (store nothing yet).
- Footer with one link, "Privacy", to /privacy, and the line "Something broken? Use the report button in the corner."
- A /privacy page with a short placeholder privacy note, and a real 404 page for any other path, with a link home.
- No images that are not in the project, no external fonts, no console errors.
- Add this inside the <head> of index.html exactly as written:
<script async src="https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1/dist/mushi.loader.global.js" data-project="YOUR_PROJECT_ID" data-key="YOUR_API_KEY"></script>
```

The prompt does not wire a custom "Report a problem" button. The script-tag
loader (`packages/web/src/loader.ts`, IIFE global `MushiLoader`) calls
`Mushi.init` but does not put a `window.Mushi` handle on the page, so the
widget's own corner button is the entry point (checked 2026-11-11).

## Files (route B)

The repo layout:

```text
mushi-mushi-starter/
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  src/main.tsx
  src/App.tsx
  src/NotFound.tsx
  public/404.html        (GitHub Pages / static hosts fall back to it)
  README.md
  LICENSE                (MIT, copied from kensaurus/mushi-mushi)
```

**`index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your App: join the waitlist</title>
    <meta name="description" content="Your App does one useful thing. Join the waitlist to hear first." />
    <!-- Mushi Mushi report button. Replace both values with the ones from your Mushi Mushi console (Set up → Install widget → Script tag). -->
    <script async src="https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1/dist/mushi.loader.global.js" data-project="YOUR_PROJECT_ID" data-key="YOUR_API_KEY"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**`package.json`** (pin exact versions at creation time, from `npm view <pkg> version`):

```json
{
  "name": "mushi-mushi-starter",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview" },
  "dependencies": { "react": "<exact>", "react-dom": "<exact>" },
  "devDependencies": { "@types/react": "<exact>", "@types/react-dom": "<exact>", "@vitejs/plugin-react": "<exact>", "typescript": "<exact>", "vite": "<exact>" }
}
```

**`vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react()] })
```

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022", "DOM"], "module": "ESNext",
    "moduleResolution": "Bundler", "jsx": "react-jsx", "strict": true, "noEmit": true
  },
  "include": ["src"]
}
```

**`src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { NotFound } from './NotFound'

const path = window.location.pathname.replace(/\/+$/, '') || '/'
const Page = path === '/' ? App : NotFound

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
```

**`src/App.tsx`**

```tsx
import { useState } from 'react'

export function App() {
  const [joined, setJoined] = useState(false)
  return (
    <main style={{ maxWidth: 560, margin: '15vh auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Your App</h1>
      <p>One sentence about what it does for whom.</p>
      {joined ? (
        <p role="status">Thanks, you're on the list.</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setJoined(true) }}>
          <label>
            Email <input type="email" required autoComplete="email" />
          </label>{' '}
          <button type="submit">Join the waitlist</button>
        </form>
      )}
      <footer style={{ marginTop: 48, fontSize: 14 }}>
        Something broken? Use the report button in the corner. It goes straight to the maker.
      </footer>
    </main>
  )
}
```

**`src/NotFound.tsx`**

```tsx
export function NotFound() {
  return (
    <main style={{ maxWidth: 560, margin: '15vh auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Page not found</h1>
      <p><a href="/">Back to the home page</a></p>
    </main>
  )
}
```

**`public/404.html`:** a copy of `index.html`, so a static host serves the app
(and its "Page not found" view) for unknown paths.

There is no `/privacy` link in route B on purpose: the check counts a dead
footer link as breakage, and a starter should not ship one.

## README draft (`README.md` of the starter)

```markdown
# Your App: a starter that passes the free check on day one

Your AI wrote it. Mushi Mushi tells you why it broke.

A one-page waitlist site built with Vite and React, with the
Mushi Mushi report button already in. It avoids the things people hit
in new AI-built apps and never report: a "Lovable App" title, footer links
to pages that don't exist, a missing 404 page, errors on load.

## Use it

1. Remix it in Lovable (<remix link>), or clone it:
   `git clone https://github.com/kensaurus/mushi-mushi-starter`
2. Sign up free at Mushi Mushi and copy your project id and key:
   https://kensaur.us/mushi-mushi/docs/quickstart/lovable-bolt?src=starter.lovable
3. In `index.html`, replace `YOUR_PROJECT_ID` and `YOUR_API_KEY` with yours.
4. Publish, open the live site, tap the report button and send "Testing".
   It shows up in your Mushi Mushi console in seconds, explained in plain English.

## Check it

Paste your live URL into the free check (no sign-up):
https://kensaur.us/mushi-mushi/docs/check?src=starter.lovable

## What's free

The report button and a plain-English explanation of each report, with a fix
your AI can apply, for one app. Mushi Mushi pays for the AI.

MIT licensed. Mushi Mushi itself: https://github.com/kensaurus/mushi-mushi
```

## Before publishing

- [ ] **Run the free check on the published starter.** It must come back with
  no visitor-facing findings, or the template contradicts itself.
- [ ] **Placeholders only.** `YOUR_PROJECT_ID` and `YOUR_API_KEY` are never
  replaced with the owner's real key. A real key would file reports into the
  owner's project.
- [ ] **Exact versions** in `package.json`, at least two weeks old.

## Success metric and kill switch

- **Metric:** projects whose first `sdk_seen_live` follows a `starter.lovable`
  first touch; 2 or more in 4 weeks.
- **Kill switch:** fewer than 2 in 4 weeks. Leave the template up and stop
  linking it from posts.
