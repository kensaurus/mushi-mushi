# 0073. Native apps in UX runs; personas are project profiles; test accounts are a per-project opt-in; a run reserves its budget

Status: Accepted (owner 2026-11-27, "approved on all lines"; Plan 025 P2 and P3: "all approved — make sure they are immersive and interactive and graphical UI/UX too").
Date: 2026-11-27

Two parts, one decision record (the Plan 025 ADR numbers were reserved per
branch: 0073 is P2 + P3).

## Part 1 (P2). UX captures come from any driver, native apps included

Amends ADR [0067](0067-ux-scorecard-scores-pages-on-a-written-rubric.md)
(the UX scorecard captures pages with its own browser). Related: Plan 025
(`docs/execplans/ecosystem-loop.md`, P2), ADR
[0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md) (the UX loop runs
on the person's machine), ADR [0039](0039-better-models-make-mushi-better.md)
(facts in code, judgement to the model), migration
`20261127150000_ux_native_captures.sql`, `_shared/ux-captures.ts`,
`api/routes/ux-captures.ts`, `packages/ux/src/upload.ts`,
`packages/ux/src/native-facts.ts`, `packages/mcp/src/ux-captures.ts`,
`docs/templates/ux-native/`.

### Context

UX runs saw only the web: the scorecard opens Playwright on a URL. The
first-run problems Plan 025 set out to fix were found in native apps (a
Capacitor shell, Android and iOS builds), where no browser can drive the
screen. `mushi-ux scorecard --from-captures <dir>` already scored captures
another driver wrote in the scorecard's own layout, but only on the machine
that ran the CLI, and only as a web run.

### Decision

1. **One upload route.** `POST /v1/ux/captures` takes pages in the
   scorecard's capture shape (`facts` + `early`/`settled` screenshots), opens
   an ordinary scorecard run (`ux_runs.kind = 'scorecard'`) with a
   `platform` (web, ios, android, flutter, react_native, capacitor, other), a
   `device` and a `capture_source` (playwright, maestro, adb, simctl, sdk,
   other), and returns one signed upload URL per screenshot. Scoring, grouping
   and filing are the scorecard's existing routes, so the rubric, its probes
   and the judge apply unchanged (0067 stays the one rubric).
2. **Auth is an `mcp:write` key or a console session, never the SDK key.**
   The public SDK key (`report:write`) ships inside app bundles; with it anyone
   could fill the app's storage and spend its AI budget. The app is the key's
   own, else the one named; viewers cannot upload.
3. **Any driver.** `mushi-ux upload <dir> --platform <p>` reads
   `<dir>/pages/<screen>/settled.png` (plus `early.png`, `facts.json`, an
   Android `uiautomator` dump as `window.xml`, or a `maestro hierarchy` as
   `hierarchy.json`), checks each PNG (signature, at most 8 MB), uploads,
   and with `--score` scores each screen on the server, groups the causes and
   closes the run. The screen's text and tappable labels come from the
   hierarchy when there is one, so the judge does not score a phone screen
   blind; facts Mushi cannot measure on a device (settle time, axe) are
   recorded as "not measured" (`null`), never guessed. The MCP tool
   `upload_ux_captures` takes the same pages and returns the upload URLs on
   both transports; the stdio server also accepts a `dir`.
4. **Templates, not a device farm.** `docs/templates/ux-native/` ships a
   Maestro flow, an `adb` script, an iOS-simulator script and a note on the
   SDKs' debug screenshot capture. Mushi never drives the device: the
   founder's own machine or CI does (0020).
5. **Native runs show where they came from.** The UX runs list shows a
   platform badge; a native run keeps `start_url` null and its line
   ("Android · Pixel 8 · viewport 1080x2400"), because the closing sync may
   omit `start_url`.
6. **Scoring reserves its budget first** (Part 2):
   one estimate a page plus the grouping call, capped by `maxCostUsd`; a call
   past the reservation is refused (402 `RUN_BUDGET_SPENT`).

### Rejected

- **A native rubric.** Two rubrics would drift and their scores would not
  compare; the 0067 rubric already judges what a reader of the screen gets.
- **The SDK key.** See 2.
- **Uploading through the CLI's existing scorecard routes only.** They need
  the run to exist first and have no platform, so a native run would show as
  a web run with no address.
- **Mushi driving emulators or a device cloud.** Cost, credentials and
  device access belong to the founder's own machine or CI.

### Consequences

- A phone app gets page scores and root causes on the same scale as its web
  pages, and every run carries its platform.
- Text-less captures (a bare PNG with no `facts.json` or hierarchy) score on
  pixels only; the upload says nothing is measured rather than inventing it.

## Part 2 (P3). Personas are project profiles; test accounts are a per-project opt-in; a run reserves its budget

**Amends ADR [0053](0053-fresh-eyes-runs-may-sign-up.md)** and its
2026-10-28 amendment: "Synthetic accounts (Mushi only)" and "Test accounts:
minted at claim time … Only an operator's console session on Mushi's own
project may ask for them". Related: Plan 025
(`docs/execplans/ecosystem-loop.md`, P3), ADR
[0048](0048-local-workers.md) (local workers), Part 1 (native captures), migration
`20261127150100_project_personas.sql`, `_shared/personas.ts`,
`_shared/llm-reservations.ts`, `_shared/test-account-hook.ts`,
`_shared/test-account-hook-io.ts`, `api/routes/personas.ts`,
`api/routes/fresh-eyes.ts`, `api/routes/work-fresh-eyes.ts`,
`pdca-runner/index.ts`.

### Context

Mushi is for any solo founder, but three parts of the first-time user test
assumed Mushi itself:

- The visitor was always the same stranger with a typed goal. A founder could
  not ask "would a Japanese phone user get through?" or "a screen-reader
  user?". The five rubric critics (`agent_personas`) judge a page against a
  method, not as a kind of user.
- Test accounts could only be made "for Mushi itself, by its operators". They
  are users in Mushi's own sign-in, which no other app can use, so every other
  app's test stopped at its sign-up wall.
- No run held budget before it started. The monthly AI budget was checked
  call by call, so two big runs could start on the last dollars, and one run
  had no cap of its own.

### Decision

1. **`project_personas`, beside the rubric critics.** A persona is a user
   profile the project keeps: name, goal, locale, device, expertise,
   accessibility needs, patience (a step cap, 5–80) and a cost cap ($0.05–$20
   a run). Members read them (RLS `private.is_project_member`); the API writes
   them; deleting archives, so past runs keep theirs. Six presets: first-time
   visitor, power user, older visitor, Japanese visitor, screen-reader user,
   impatient phone user. The console's Persona studio edits them with a live
   preview of the brief and of what the visitor will try.
2. **A persona changes the browser, not only the prompt.** The visitor model
   reads a short brief (about 400 characters, a few dozen tokens a step, no
   extra model call). The device sets the viewport, touch and pixel ratio;
   the locale sets the browser language; low vision reads at 150% zoom;
   reduced motion sets `prefers-reduced-motion`. The User-Agent never changes
   (0053 relies on the headless UA to drop these runs' product events). The
   step cap is the persona's patience.
3. **Run now and PDCA take a persona id.** `POST …/fresh-eyes { personaId }`
   (checked to be the project's own) stores `ux_runs.persona_id`; the claim
   carries the persona only to a daemon that says it forwards one
   (`work_hosts.takes` gains `fresh_eyes_persona`); an older daemon runs a
   plain visitor and the run row says so. `POST /v1/admin/pdca
   { user_persona_id }` stores `pdca_runs.project_persona_id`; the critic
   reads one paragraph on who the user is on top of its rubric prompt. The MCP
   tools `list_personas` and `start_fresh_eyes` drive both from an editor;
   `start_fresh_eyes` fills the start page and goal as the console would.
4. **Test accounts are a per-project opt-in** (`project_settings.fresh_eyes_accounts`,
   default `off`), replacing "Mushi's own project only":
   - `hook`: the app's own backend makes the account. Mushi POSTs a signed
     `mushi.test_account.create` (`X-Mushi-Signature: t=<unix>,v1=<HMAC-SHA256(secret, "<t>.<body>")>`)
     to the https address the owner gave, at claim time, one per visitor, and
     passes the answer to the worker once; it never stores the password. The
     address is checked like every user-given address (public host, no port,
     every DNS answer public), redirects are refused, the answer is read up to
     8 KB. When the run ends Mushi sends `mushi.test_account.expire` with the
     account ids; the hook must also delete them by `expires_at` (24 h). The
     signing secret lives in Vault and is shown once.
   - `mushi`: the existing internal mint (0053), for an app that signs in on
     this Mushi deployment; only that deployment's operators may turn it on or
     grant it, because it creates users in Mushi's own auth.
   - Kept from 0053: only an owner's or admin's console session grants
     accounts for one run (never an API key, so no agent or MCP tool can); the
     grant lasts 2 hours and is spent in the claim's compare-and-set; accounts
     are made only for a claiming machine that belongs to the person who
     granted them; at most 12 an hour (per operator for `mushi`, per app for
     `hook`); passwords travel only in the claim answer (`no-store`).
5. **A run reserves its AI budget before it starts** (`llm_run_reservations`):
   - a fresh-eyes run reserves what classifying its filed reports may cost
     (the visitor model is the person's own Cursor CLI, which Mushi does not
     pay for), a captures run one call per page plus the grouping;
   - the persona's cost cap (or `maxCostUsd`) caps the reservation, and the
     reservation is the run's hard cap: each call charges its estimate and
     one that does not fit is refused (402 `RUN_BUDGET_SPENT`);
   - a run starts only if the monthly budget, minus this month's spend, minus
     every other open reservation, covers it; the RPC serializes this per
     project. A budget that cannot be read refuses the start;
   - done, failed, cancelled, expired-in-queue and lost-lease runs release
     what they did not charge; an open reservation stops counting after its
     TTL.
   `assertLlmBudget` on the triage hot path is unchanged. Reservations deal in
   estimates; priced spend stays in `llm_invocations`.
   **Not covered yet:** a browser scorecard run from the CLI
   (`mushi-ux scorecard --score-via server`) creates its run before it knows
   its page count, so it reserves nothing and stays under the monthly budget
   alone; its routes charge a reservation only when one exists. The Cursor
   agent credits (`agent-credits.ts`) are not part of a reservation: the
   visitor model is the person's own Cursor CLI, not a key Mushi spends.

### Rejected

- **Personas as more `agent_personas` rows.** Those are critics with rubrics,
  global to the deployment; a user profile is the project's, has a device and
  a locale, and drives the browser.
- **A model-written persona or a model-generated avatar.** Tokens for no
  measured gain, and an image API is an outside dependency; the studio
  composes the avatar from the attributes.
- **Spoofing a phone User-Agent.** It would make these runs count as real
  product traffic (0053).
- **Opening the internal mint to every project.** Accounts in Mushi's sign-in
  are useless to an app with its own backend, and any customer could create
  confirmed Mushi users.
- **Storing a test account's password** (a project-wide test login). A stored
  credential sits in the database between runs; the hook makes a fresh
  account per visitor and Mushi forgets it.
- **Reserving inside `assertLlmBudget`.** Every feature's call would see the
  UX runs' holds, and the hot path would take a lock.
- **A ledger of the visitor model's spend.** Mushi never sees it (the
  person's own Cursor account).

### Consequences

- Any founder can test as a Japanese phone user, a screen-reader user or an
  impatient visitor, and see each persona's time to first value over time.
- Apps with their own backend can let a first-time user test sign up by
  adding one endpoint; until they do, their tests stop at the sign-up wall as
  before.
- A big run can no longer start on the last of the month's budget, and one
  run never spends past its persona's cap.
- The dogfood apps get no special path: they opt in like any other app.
