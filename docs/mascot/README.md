# Mascots: Mushi-chan and Field Kenji 🐛

Mushi Mushi has two characters with two jobs.

| Character | Who | Job | Where |
| --- | --- | --- | --- |
| **Mushi-chan** | A small red ladybug | The product mascot and the brand's narrator | README, social posts, launch art, changelog voice |
| **Field Kenji** | A young, clean-shaven bug naturalist in a field-guide style (pen line and watercolour), with Mushi-chan on his shoulder | The guide inside a flow: he says what is happening and what to do next. His face is also the app icon | The console, the docs quickstarts, the landing hero, the Bounties pages; his face in the console sidebar, the docs navbar and the hero eyebrow |

Kenji is the human guide beside Mushi-chan. She stays the mark; he explains.

## Mushi-chan

The four canonical expressions, generated as a consistent character set.

| File | When to use |
| --- | --- |
| [`mushi-happy.png`](./mushi-happy.png) | Default avatar. Profile pictures, blog headers, neutral tweets. |
| [`mushi-worried.png`](./mushi-worried.png) | "Critical bug spotted" social posts, Sentry-pager moments, `severity=critical` rows. |
| [`mushi-sleeping.png`](./mushi-sleeping.png) | "All systems quiet" / "no bugs in the last 24h" / late-night posts. Pairs with the *All Clear* admin banner. |
| [`mushi-waving.png`](./mushi-waving.png) | Welcome moments — first-run tour, onboarding success screen, `npx mushi-mushi` finished, launch-day tweet. |

### Character notes

- **Species:** stylised ladybug (`mushi` = bug in Japanese; the red-and-black palette is on-brand).
- **Vibe:** kawaii but competent. Yuru-kyara energy, not sticker-pack energy.
- **Palette:** red shell `#d94545`, cream-pink belly `#fce6dd`, black eyes, deep-burgundy soft outline. The shell colour matches the `severity=high` accent in the admin console (`tw-red-500`).
- **Always:** centred, transparent background, soft drop-shadow underneath, looking at the viewer (except `mushi-sleeping.png`).
- **Never:** holding tools, "fixing" anything literal, sad/angry. Mushi catches bugs *empathetically* — she's the friendly observer, not the exterminator. This holds in Kenji's art too: she rides on his shoulder, cheers on his notebook, or sleeps on his knee; the magnifying glass and the laptop are always his.

### Regeneration

These were generated via the agent loop on **2026-04-23** with explicit
character-consistency anchors. To regenerate (e.g. for a new pose) keep:

- The reference image (`mushi-happy.png`) in the prompt's `reference_image_paths`.
- The exact phrase: *"round chubby kawaii ladybug-like mascot Mushi-chan with red dome shell + 5 black spots, two tiny rounded antennae, big round shiny pure-black eyes with white highlights, soft cream-pink belly, deep-burgundy soft outline, pastel cel-shading."*
- A 1024×1024 transparent canvas request.

The 1200×630 GitHub social preview lives in [`../social-preview/og-card.png`](../social-preview/og-card.png) (rendered by `scripts/gen-og-card.mjs`; it uses the 虫 stamp, not Mushi-chan).

## Field Kenji

Kenji is the same character as in the other KENSAURUS apps (top-knot bun,
rectangular dark glasses, a calm half-smile, head a little large for his
body), drawn here as a bug naturalist: white turtleneck, khaki field vest,
brass magnifying glass, field notebook, vermillion `#E03C2C` as the one strong
accent. Each app draws him in its own art style; this is Mushi Mushi's.

### Poses

| Pose | Journey state | Console | Docs | Bounties |
| --- | --- | --- | --- | --- |
| `wave` | Welcome, first open | Sign-in; Set up overview before any app exists | Quickstart; landing hero (desktop only) | Join |
| `point` | A setup step or a tip | First run "Name your project"; Set up tabs; first diagnosis before sending | | Empty leaderboard |
| `magnify` | Diagnosing, loading | First diagnosis while sending, queued and classifying; Set up "Test it" tab | | |
| `found` | Diagnosis ready, success | First diagnosis ready; setup complete; editor connected | | |
| `think` | Waiting, nothing found | Offline, quota used, slow diagnosis; 404; editor on an old address; Set up "Fix a problem" tab | 404 | |
| `allclear` | Empty because nothing is wrong (Mushi-chan asleep on his knee) | Home "Needs you", only when every read answered and the app has real reports | | |
| `oops` | Something failed | Crash screen; test report or diagnosis failed | | |
| `laptop` | Connect an editor, install | Connect page; Set up "Install" tab | MCP quickstart | |

Files: `apps/admin/src/assets/mascot/`, `apps/docs/assets/mascot/`,
`apps/testers/app/assets/mascot/`. Each app ships only the poses it uses, as
a 600 px WebP plus a 300 px `-sm` WebP (transparent, square, feet on one
baseline), imported so the URL is hashed. Assets live inside each app, never
on a CDN: error and empty states must render offline.

### Component

- Console: `Mascot` in `apps/admin/src/components/mascot/Mascot.tsx`. Props:
  `pose`, `line`, `size` (`sm` 64 / `md` 96 / `lg` 144 px), `surface`
  (`console` adds a paper spot behind him so the watercolour reads on the dark
  theme; `paper` for the editorial 404 and crash screens), `layout`.
- Docs: `<Mascot pose line />`, registered in `apps/docs/mdx-components.tsx`.
- Bounties: `apps/testers/app/components/Mascot.tsx`.

The figure is decorative (empty `alt`, hidden from assistive tech). The line is
real text, with a small "Kenji" name above it and a vermillion margin rule.
If the image fails to load, the figure is dropped and the line stays.

Motion is CSS only: a short entrance, then a 2 px sway for three slow cycles,
then rest. Under `prefers-reduced-motion` he is a still image.

### Voice

Every console line lives in `apps/admin/src/lib/fieldGuide.ts`, keyed by
journey state; `fieldGuide.test.ts` checks each one.

- First person, one line, **90 characters at most** (fits a phone).
- A calm, curious naturalist. Plain over precise: what happened, what to do next.
- Never blames the developer. A failure on our side is "on us".
- Never cutesy, no exclamation marks, no hype (the VOICE.md banned list applies).
- Only mentions buttons that are on that screen.
- Writes "Mushi Mushi", never a bare "Mushi".

### Placement rules

- **At most one Kenji per screen.** Each route has one owner. This counts
  the posed figure, the guide. His round face in the chrome (sidebar, navbar,
  hero eyebrow) is the brand mark, like the favicon, and does not count.
- **Never in a customer's app.** Not in the SDK widget (`packages/web`,
  `packages/core`, `packages/react-native`) and not in the "powered by"
  footer (`_shared/brand-footer.ts`). Customers' apps are not our canvas.
- **Never fake a state.** "All clear" needs every read to have answered and an
  app that has received real reports; a new, empty app is unchecked, not clear.
- Not on inline panel errors (`PageLoadError`): a page can show several, and
  that would put several Kenjis on one screen.
- Idle motion rests after three cycles; reduced motion shows a still frame.

### Where the art came from

Generated 2026-11-13 for the KENSAURUS mascot family: one fal
`nano-banana-2.1` edit call per pose (2K, square), with the approved
Mushi Mushi style sheet and `mushi-happy.png` as references, then background
removal with `fal-ai/birefnet/v2`, trimmed and padded to a common baseline.
The pipeline, prompts and spend log live in the glot.it repo
(`scripts/kensaurus-mascot/`). Like Mushi-chan, the art is all rights reserved
(see [`TRADEMARK.md`](../../TRADEMARK.md)).

### Icon

Since 2026-11-13 the console and docs icons are Field Kenji's face in a paper
specimen disc on the vermillion field, with Mushi-chan on the rim of his
glasses. Before that they were the 虫 hanko stamp, which said nothing about who
the guide is (owner, 2026-11-13).

- Master: `docs/mascot/field-kenji-icon.png` (1024², opaque). It came from the
  same pipeline as the poses, with the style sheet and `mushi-happy.png` as
  references, picked from two options for legibility at 32 px.
- Console (`apps/admin/public`): `favicon.svg` is a 64 px render inside an SVG
  with explicit `width` and `height`, which `src/lib/favicon.ts` needs to draw
  the badge. `icons/icon-192.png` and `icons/icon-512.png` are the PWA icons;
  `icons/icon-maskable-512.png` holds the art at 80% on the vermillion field.
- Docs (`apps/docs/public`): the same `favicon.svg`, plus `apple-touch-icon.png`,
  `icon-192.png` and `icon-512.png`.
- Social card: `scripts/gen-og-card.mjs` uses the icon as the brand stamp and
  the wave pose beside the headline. GitHub's social preview is uploaded by
  hand from `docs/social-preview/og-card.png`.
- In the chrome (since 2026-11-14): `kenji-face.webp` is the icon cut to its
  paper disc with a thin vermillion ring, 96 px, transparent, in
  `apps/admin/src/assets/brand/` and `apps/docs/assets/brand/`. It sits before
  the wordmark in the console sidebar (alone in the icon rail and in the
  phone header), before "Mushi Mushi" in the docs navbar (only at widths
  where the row has room; see `globals.css`), and in the landing hero's eyebrow, where
  the vermillion dot stamp was. The console brand and the docs logo both link
  to the landing page; decorative (`alt=""`), the link carries the name.
- The landing hero shows the `wave` pose beside the copy at 1024 px and up
  (a `<picture>` source, so phones download nothing). It is decorative and
  not clickable, so the hero keeps its two actions (ADR 0056).
- The SDK widget, the npm packages, `packages/brand` and the testers app keep
  their marks. The placement rules above apply to the icon too.
