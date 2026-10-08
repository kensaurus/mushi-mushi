# @mushi-mushi/ux

> **Your AI wrote it. Mushi tells you why it broke.**

Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.

Find the UX bugs on every screen of your app before your users do, and let
the coding agent you already pay for fix them one screen at a time. You watch
each attempt live and keep only the changes that measurably help.

```bash
npx @mushi-mushi/ux ui          # the studio: pick agent, model and skill, start, watch
# or, through the Mushi CLI (passes your login, so runs can show in the console):
mushi ux ui
mushi ux run --dev "pnpm dev --port {port}" --agent cursor --model grok-4.7 --skill enhance-mobile-native-feel
```

## The studio

`mushi-ux ui` opens a page on 127.0.0.1 (behind a one-time token) with two parts.

- **New run.** Pick the agent (only installed ones are offered), then a model
  from the list your account returns: `agent models` for Cursor, Cursor's API
  (with each model's effort and context settings) for Cursor Cloud, Anthropic's
  or OpenAI's model list when their key is set. Any id can still be typed. Pick a
  skill from [kensaurus/skills](https://github.com/kensaurus/skills) (or a
  path), the dev command (the framework's own command is suggested first; it
  skips `predev` hooks that some repos use to kill dev servers), the ref to
  branch from (the remote tip is suggested when your checkout is behind or
  dirty), and the pages to start from.
- **Watching a run.** The phase (installing, mapping, working on "Home,
  attempt 2 of 2"…), a progress bar by outcome, the screen list, every
  attempt's screenshot at phone and desktop width against the baseline with a
  slider and a changed-pixels overlay, the measured problems, and what the
  agent is doing, as steps ("read app/page.tsx", "edit globals.css"), with
  the files changed so far and the time used out of the attempt's time box.
  A working run checks in every 30 seconds; if it stops checking in, the page
  says so. Past runs stay in the run picker.
- **Small steps** (on by default in the studio, `--steps` in the terminal).
  The agent first spends up to 5 minutes listing 2–5 small, separate
  improvements for the screen without editing. Then each attempt makes
  exactly one of them, touching at most a few files, and the step is
  measured and kept or rolled back on its own. The screen shows the plan as
  a checklist. A step that changes more than 6 files is rolled back as too
  big. "Attempts per screen" caps the steps.
- **Resume.** A run that stopped for any reason (Stop, a closed terminal, a
  sleeping laptop, a killed process) shows **Resume**. It carries on from the
  first unfinished screen with the settings it started with: the branch goes
  back to its last kept commit, a half-finished attempt is thrown away and
  runs again, and an interrupted install runs again. From the terminal:
  `mushi-ux run --resume <runId>` (nothing else needed).

## What a run does

0. Checks the agent can run and read a file (about a minute), so a signed-out
   agent or a blocked tool fails before anything slow starts. `--no-preflight`
   skips it.
1. Creates a git worktree on a new branch `mushi-ux/<run>` and starts your dev
   server in it on a spare port. Your own checkout is never touched.
2. Maps the app: every same-origin page, plus the tabs, dialogs and menus each
   page opens. Pages with the same structure (`/items/1`, `/items/2`) count
   once.
3. For each screen:
   - Captures a baseline at desktop and phone width and measures it:
     accessibility (axe), sideways scrolling, tap targets under 24×24 px,
     console errors and layout shift. Dev-server overlays, build stamps and
     the Mushi widget are hidden and skipped, as is anything you mark with
     `data-mushi-ux-ignore` or pass with `--ignore <selector>`.
   - Hands the agent the screenshots, the measured problems and pointers to
     your design tokens.
   - When the agent finishes, recaptures, pixel-diffs and re-measures.
   - **Keeps** the edit as a commit if nothing measured got worse and
     something visibly changed. Otherwise **rolls it back** and lets the agent
     try once more with the reason.
4. After each kept change, re-shoots the screens already done. Any that moved
   (a shared component or token changed) are marked **regressed**.
5. Optional: a second model (default `claude-opus-5-5`, your own Anthropic
   credentials) compares each changed screen before vs after. Images are shown
   in random order, and every claim must point at a region. The review is
   advisory; it never keeps or reverts anything.
6. Leaves you a branch to review and open as a draft PR. Nothing is merged.

A local dashboard (printed at start, `127.0.0.1` only, token-protected) shows
the burndown, a before/after slider, a diff overlay, problem scores per screen,
and the agent's output as it streams.

## Safety

- **Exploring never writes.** Every non-GET request is aborted, forms are never
  submitted, and buttons labelled delete / pay / send / log out are never
  clicked. If your app reads data with POST (Supabase `rpc`, GraphQL), allow
  those reads: `--allow "POST /rest/v1/rpc/*"`.
- **Signed-in apps:** run `mushi-ux login --url http://localhost:5173` once and
  sign in by hand in the window that opens. Later runs reuse that session with
  `--login-url`. The coding agent never sees the session, its location, or
  your Mushi credentials. Use a test account if your dev server talks to
  production data.
- The agent runs with credentials stripped from its environment, except its
  own model key. Claude Code runs in restricted mode: no shell, and files
  limited to the worktree.
- Your dev server and install command run code the agent edited, so they get
  your environment without this tool's own keys (`CURSOR_API_KEY`,
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `MUSHI_*`). If your app
  needs one of those, put it in the app's `.env` file: ignored `.env*` files are
  copied into the worktree.
- **What `--sync` sends to the console:** the run's phase, screens, scores,
  measured problems (counts, not console text), screenshots, and the names of
  the files each attempt read or edited. The agent's own words, the commands
  it ran and their output stay on your machine (`.mushi/ux/<run>/agent/`).

## Agents

| `--agent` | Needs | Status |
| --- | --- | --- |
| `claude-code` | `claude` on PATH | Verified on Windows |
| `cursor` | Cursor CLI (`agent`), signed in with `agent login` | Verified on Windows (see below) |
| `codex` | `codex` on PATH | Unverified |
| `cursor-cloud` | `CURSOR_API_KEY` and an `origin` on GitHub | Unverified |

`cursor-cloud` runs each attempt in a Cursor Cloud agent: the run branch is
pushed, the agent commits onto it on Cursor's side, and its change is applied
back to the worktree for measuring. Every push of a run is under
`mushi-ux/**`; if your CI runs on every push, add `branches-ignore:
['mushi-ux/**']` to its `push:` trigger.

`mushi-ux models --agent <name>` lists the models an agent can use.

**Cursor CLI and Claude Code hooks.** The Cursor CLI also runs the hooks in
`~/.claude/settings.json`. On Windows a hook can fail when the run starts from
Git Bash, and then every file read is refused. The agent check at the start
of a run catches this and says so: start `mushi ux` from PowerShell or cmd
instead, or fix the hook.

`--skill` takes a skill name from [kensaurus/skills](https://github.com/kensaurus/skills)
(`mushi-ux skills` lists them; `--skills-repo owner/repo@ref` for another repo;
`MUSHI_UX_SKILLS_DIR` for a local checkout) or a path to a `SKILL.md` or skill
folder. The whole folder, references included, is given to the agent.
Without a skill the agent gets built-in UX guidance.

## Commands

```text
mushi-ux ui                                   the studio (launcher + live view)
mushi-ux login    --url <url>                 sign in once, headed
mushi-ux discover --url <url>                 list the screens, edit nothing
mushi-ux run      --dev "<cmd with {port}>"   the loop
mushi-ux models   --agent <name>              models your account can use
mushi-ux skills                               skill names --skill accepts
mushi-ux open     <runId>                     dashboard for a past run
```

## On GitHub Actions

Copy [`docs/templates/mushi-ux.yml`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/templates/mushi-ux.yml)
to `.github/workflows/mushi-ux.yml` and set its `dev-command`. Start it from
the Actions tab, or with **Run in the cloud** on the console's UX runs page.
It runs `cursor-cloud` only (a local agent could read the checkout's token),
syncs to the console, and opens one draft PR with the changes it kept. Runs
see the app signed out.

Useful `run` options:

| Option | Default | What it does |
| --- | --- | --- |
| `--max-surfaces` | 10 | How many screens to work on. |
| `--iterations` | 2 | Attempts per screen. |
| `--timeout` | 10 | Minutes per attempt. |
| `--base <ref>` | HEAD | Branch the run from this ref, e.g. `origin/main`. |
| `--steps` | off | Plan each screen into small steps first, then one measured step per attempt (`--iterations` caps the steps). |
| `--ignore <selector>` | — | An element that is not your app's UI (a dev badge): hidden in screenshots, skipped by every check. Repeatable. |
| `--resume <runId>` | — | Continue a stopped run with the settings it started with; other options are ignored. |
| `--no-preflight` | — | Skip the agent check at the start. |
| `--no-judge` | — | Skip the final review. |
| `--no-dashboard` | — | Don't start the local dashboard. |

Monorepos: the fresh worktree needs its workspace packages built before the
app's dev server starts, for example
`--install "pnpm install --frozen-lockfile --prefer-offline && pnpm turbo run build --filter=<app>^..."`.
`--sync` refuses to run when the repo's app reports to another Mushi project
(its `*_MUSHI_PROJECT_ID` env var) than your login, so a run never lands on
the wrong app.
Signed-in apps: if most routes redirect to a sign-in page, discovery says so
and stops; run `mushi-ux login` first.

Run state and screenshots live in `.mushi/ux/<runId>/`. The run adds `.mushi/`,
`.worktrees/` and `.mushi-ux/` to your clone's `.git/info/exclude` (local, never
committed), so `git status` stays clean. Only `.env*` files your repo already
ignores are copied into the worktree, so they can't end up in a commit.

## License

MIT
