# Mushi-chan mascot kit 🐛

The four canonical expressions of Mushi-chan, generated as a consistent
character set and used across the README, the GitHub social preview, the
admin console first-run tour, and Bluesky / X posts.

| File | When to use |
| --- | --- |
| [`mushi-happy.png`](./mushi-happy.png) | Default avatar. Profile pictures, blog headers, neutral tweets. |
| [`mushi-worried.png`](./mushi-worried.png) | "Critical bug spotted" social posts, Sentry-pager moments, `severity=critical` rows. |
| [`mushi-sleeping.png`](./mushi-sleeping.png) | "All systems quiet" / "no bugs in the last 24h" / late-night posts. Pairs with the *All Clear* admin banner. |
| [`mushi-waving.png`](./mushi-waving.png) | Welcome moments — first-run tour, onboarding success screen, `npx mushi-mushi` finished, launch-day tweet. |

## Character notes

- **Species:** stylised ladybug (`mushi` = bug in Japanese; the red-and-black palette is on-brand).
- **Vibe:** kawaii but competent. Yuru-kyara energy, not sticker-pack energy.
- **Palette:** red shell `#d94545`, cream-pink belly `#fce6dd`, black eyes, deep-burgundy soft outline. The shell colour matches the `severity=high` accent in the admin console (`tw-red-500`).
- **Always:** centred, transparent background, soft drop-shadow underneath, looking at the viewer (except `mushi-sleeping.png`).
- **Never:** holding tools, "fixing" anything literal, sad/angry. Mushi catches bugs *empathetically* — she's the friendly observer, not the exterminator.

## Regeneration

These were generated via the agent loop on **2026-04-23** with explicit
character-consistency anchors. To regenerate (e.g. for a new pose) keep:

- The reference image (`mushi-happy.png`) in the prompt's `reference_image_paths`.
- The exact phrase: *"round chubby kawaii ladybug-like mascot Mushi-chan with red dome shell + 5 black spots, two tiny rounded antennae, big round shiny pure-black eyes with white highlights, soft cream-pink belly, deep-burgundy soft outline, pastel cel-shading."*
- A 1024×1024 transparent canvas request.

The 1280×640 GitHub social preview lives in [`../social-preview/og-card.png`](../social-preview/og-card.png).
