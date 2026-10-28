# @mushi-mushi/ux

## 0.3.0

### Minor Changes

- 0c93c23: `mushi-ux fresh-eyes --request-stdin` reads a run the console queued (its id, start page, goal, visitors and test accounts) as JSON on stdin, so a local worker passes nothing in arguments. `--dry-run --sync` now shows the run in the console, marked look around only; it still writes nothing to your app and files nothing. A failed console sync exits with code 1.

  Fixes from the first live run on Mushi:

  - The model reads a page's main content first, then its navigation, so a long docs sidebar no longer hides the article. Controls a mouse user cannot see, such as a "Skip to content" link, are left out, and a click always goes to the copy you can see.
  - A click that opens a window on the app (a sign-in popup) is followed. A window outside the app is closed and noted.
  - An opinion that the page shows nothing, or only a menu, is not filed when the page's main content has text.
  - Waiting for content no longer counts small pulsing dots, such as a notification badge, as loading. Real skeletons, spinners and progress bars still count. A wait that hits its cap is marked on its step and never counted as the app's time.
  - With a test account, the default is 60 steps (30 without). The minted account's user id is printed in the log and the timeline, never its password.
  - The terminal setup runs in a home folder of its own, so it cannot replace the CLI login on the machine.

- 346cc0e: `mushi-ux fresh-eyes` tries one goal as a first-time visitor: signed out, from your landing page, with a model that reads only what is on screen. It times what the app makes the visitor wait plus reading time (never the model's own thinking) until a goal check passes, and records where each session stalled: a sign-in it cannot pass, a captcha, a dead end, an error, or a step that needs an inbox, an API key, a terminal or another account. Measured problems are filed once a replay without the model shows them again; opinions only when two sessions agree. Writes reach only your app's own origins; payments, third-party sign-in and public sign-up endpoints are refused, and `--dry-run` writes nothing. `--terminal` runs a CLI setup step itself, `--sync` mirrors the run to the console, and `timeline.md` keeps every step with its screenshot.

  The write guard gains a `writes: 'same-origin'` mode (the default stays read-only), and every mode now refuses navigations to payment and third-party sign-in pages.

### Patch Changes

- df227b7: Compare screenshots with pixelmatch 8. Color distance is now OKLab instead of YIQ. The 0.1 threshold stays: it is still a tenth of black versus white, and the same high-contrast changes still count.

## 0.2.1

### Patch Changes

- 271abb8: The `mushi-ux` and `mushi-mcp-ci` downloads no longer include source maps, like `@mushi-mushi/cli` and `@mushi-mushi/mcp`. That is about 1 MB less for every `npx @mushi-mushi/ux` and every CI job that runs the Action. The mcp-ci npm page also describes what the Action does for a pull request.

## 0.2.0

### Minor Changes

- 3910786: New `mushi-ux audit`: finds UI/UX bugs on the signed-in screens of a live app, read-only, and files them as Mushi reports. It reuses a cached, signed-in browser profile (`--profile-dir`, opened with the installed Chrome) and never opens a fresh sign-in window. Findings come from measurements first (serious accessibility rules, sideways scrolling, console errors, layout shift, a blank screen); `--review claude-code|anthropic-api` adds concrete visual defects on whole pages. `--file` files at most 15 deduped reports a run; `--dry-run` lists them. `discover` and `run` also take `--profile-dir` and `--channel`.
- 74e95e6: `mushi-ux explore` lets a model (the Cursor CLI, Grok by default) use the signed-in app like a careless user in the audit's read-only browser, and files only errors that happen again when its steps are replayed without the model (ADR 0046). `mushi-ux audit --review cursor` and `--checker-via cursor` review screenshots through the Cursor CLI in read-only ask mode.
- 863ccf9: Two new layout probes. `overlap` finds in-flow siblings drawn on top of each other, and `outgrows` finds buttons and links that stick out of their container, wrap past two lines or cut their own label off. Deliberate overlap is skipped: positioned layers, negative margins (avatar stacks), transforms, grid items placed in one cell and scroll containers. `mushi-ux audit` files them as one finding per page and rule, the agent packet and judge see them, and a run that adds overlapping or oversized boxes is rolled back.

### Patch Changes

- 6b485ac: Require zod 4.6.7 or later, which fixes GHSA-mrhx-c7xc-m3w5: validating an oversized constrained collection could exhaust memory.

## 0.1.2

### Patch Changes

- f220653: Comment-only change: no code changed in these packages. Helpers that are exported only so the package's own tests can reach them now carry an `@internal` doc tag. None of them is reachable from a package entry point, and the published type declarations differ only by that comment.

## 0.1.1

### Patch Changes

- 5ad0452: Internal cleanup with no change to what these packages export or do. Helpers and types that nothing imported, including the package's own tests, are now private to their module or removed. None of them was reachable from a package entry point.

## 0.1.0

### Minor Changes

- 2b66be6: New `@mushi-mushi/ux` (`mushi-ux`, or `mushi ux` through the CLI): maps every page, tab and dialog of a running app, runs your coding agent (Claude Code, Cursor, Codex) on one screen at a time in a separate git worktree, keeps an edit only when accessibility, layout and console measurements do not get worse, flags screens a shared change moved, and shows it all in a local dashboard. Exploring the app never sends a write request. `--agent cursor-cloud` runs each edit in a Cursor Cloud agent, and the public `ux-loop` GitHub Action plus the `mushi-ux.yml` workflow template run the pass on your repo's CI and open one draft PR. `--sync` mirrors runs to the console's UX runs page; `mushi ux-runs` and `mushi portfolio groups` read them and group projects from the terminal. `mushi-ux ui` opens a local studio: pick the agent, a model from your own account's live list (Cursor, Cursor Cloud, Anthropic, OpenAI), a skill by name from kensaurus/skills, the pages and the ref to branch from, then watch the phase, progress and every attempt's screenshot. `--sync` refuses to mirror a run to a project other than the one the app reports to. A run first checks, in about a minute, that the agent can read a file, and names the fix when it cannot (signed out; a Claude Code hook blocking the Cursor CLI under Git Bash). Screenshots and checks skip dev overlays, build stamps, screen-reader-only links and anything passed with `--ignore` or marked `data-mushi-ux-ignore`. The studio and the console show the agent's live steps, the files changed so far, the time used out of the time box, and a warning when a run stops checking in. Agent output stays local: the console gets only the files each attempt read and edited. Page names drop the site name the titles share. Every run can be resumed with only its id (studio **Resume**, or `mushi-ux run --resume <runId>`): its settings and skill are saved when it starts, the branch returns to its last kept commit, a half-finished attempt or install runs again, and a run still checking in elsewhere is never resumed twice. Layout shift counts against an edit only past the 0.1 "good" threshold, and a rollback names what got worse ("tap targets under 24 px 0 → 2"). The agent's brief lists the files that render the screen (Next.js page, layout and co-located components) and asks for a first edit within a third of the time box; an attempt that runs out of time gets one more try with that note, and a screen whose agent never finishes shows as "Not finished", not "No change needed". Console messages from the framework's own dev tooling (React's key warning from Next's `OuterLayoutRouter`, Fast Refresh) are no longer reported as the app's problems, and the agent is told to stay out of `node_modules`. Captures wait for skeleton placeholders (by class or by a running skeleton/shimmer animation), and a screen is flagged as moved by another change only when a second screenshot confirms it. When an edit's only new problem is layout shift past 0.1, the screen is shot once more and the steadier reading counts, so a hot-reload blip does not roll back a good edit. New small-steps mode (`--steps`, on by default in the studio): the agent plans each screen as 2–5 small, separate improvements without editing, then makes one per attempt; each step is measured, committed or rolled back on its own (a step over 6 files is rolled back as too big), and the studio shows the plan as a checklist. When an agent that can resume its session (Cursor) runs out of time with nothing to show, the loop continues that same session once with "time is up, write it now" (2 minutes for a plan, 3 for an edit), keeping everything it read. The console's UX runs page shows each screen's plan as a checklist ("Plan: 2 of 4 steps kept"), names attempts by their step, counts kept edits rather than improved screens, folds repeated searches in the agent's step list, puts the plan beside the phone screenshot on wide screens (attempts stay full width below), offers "File as bug" only for screens with something wrong, and lists the start-a-run form after the results. A long plan step is shortened at a word, never inside a `code` span, and file names in a step show as code. The studio launcher asks four questions in order (what to improve: the whole app or pages you pick, and a skill; who does the work: agent, model, and the account and plan it spends, with published token prices and a link to the usage page, since no agent reports remaining credit; how much: a worst-case time; your app: the dev command, with the one that last mapped screens in this repo first). The skill list comes from the skill folders, so a skill the repo index misses can still be picked. A run whose mapping finds no screen fails and says why ("every page returned HTTP 500, so the app's dev server is failing", with the dev server's first error) instead of finishing as done, and the studio shows each mapping line as it happens. A page that changes while it is read (a client-side redirect) is skipped instead of failing the run, and redirect chains and page loads are capped. Each capture now runs in a fresh browser context seeded with the session's starting storage, so app state one screen writes no longer changes how another screen renders (it caused false "moved by another change" flags). Runs are faster: each step resumes the planning session instead of re-reading the files, regression re-shoots run once per screen, phone and desktop captures run side by side, and named pages are compiled together before mapping. An optional checker (`--checker claude-opus-5-5`, through Claude Code or the Anthropic API) reviews each kept step from crops of the changed area, twice in swapped order, and rolls it back only when both reviews prefer the original (ADR 0021); a change with nothing visible is kept and flagged for review. Skills come from the `@kensaurus/skills` npm package by default and several can be chained (`--skill a,b`); the studio suggests the next skill from each skill's Related list. The studio compares each attempt with the screen it started from in three views (Changes: zoomed crops of each changed area; Side by side; Slider), and the console opens on Side by side.
