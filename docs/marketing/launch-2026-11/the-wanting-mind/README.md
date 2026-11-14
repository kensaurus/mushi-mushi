# the-wanting-mind launch kit (week of 2026-12-21)

The Wanting Mind is a free interactive book: one argument about extraction and
generation, traced through neuroscience, Buddhist philosophy, political economy
and anthropology. It comes with narration, a 3D map of its concepts and
interactive simulations. Free on the web with no account, and as an app.

The holiday week suits a long read. It's the last product in the calendar on
purpose.

**Angle:** Why do so many institutions feel like they take more than they give?
The book puts a corporation, a friendship and a civilization on the same
spectrum, from taking to giving back.

## Owner decision first: how the book was written

Several venues ban AI-created or AI-assisted work, and the book uses AI in
places the repo documents:

- **Narration:** "AI-generated audio narration powered by ElevenLabs with 12
  distinct narrator personas" (README). The personas are fictional narrators.
- **Illustrations:** "AI-generated art from a pool of 15 diverse styles"
  (README), plus AI concept thumbnails.
- **The text:** the repo doesn't say. **Only you know.**

Every post here discloses the AI narration and art. Before posting, decide how
you describe the text ("I wrote it", "written with AI help", or something
else) and use those words everywhere. The drafts avoid claiming either way.

## Claims you may use

| Claim                                                                   | Source                                                     | Checked    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- |
| Free to read, no ads, no account                                        | README; live site; Play listing "Read free"                | 2026-11-14 |
| About 147,000 words                                                     | README                                                     | repo only  |
| 22 interactive simulations; a 3D map of 268 linked concepts             | README glossary                                            | repo only  |
| Narration on the opening chapters is free; narration is AI (ElevenLabs) | README                                                     | repo only  |
| English, Japanese, Chinese and Thai                                     | store screenshot `08-four-languages`; hreflang on chapters | 2026-11-14 |
| Optional supporter purchase funds the work; the book stays free         | README glossary                                            | repo only  |
| Play: "10+ downloads", no rating; App Store: "Not enough ratings"       | live listings                                              | 2026-11-14 |

Don't link the root `/the-wanting-mind/`: it opens a full-screen language
gate with no pitch, and `/ja`, `/zh`, `/th` are thin shells (audit). Link the
preface, which is prerendered: `/the-wanting-mind/en/preface`.

## Where its readers are, with evidence

Reddit rules read from `about/rules.json` on 2026-11-14.

| Venue                 | Size                | Rule that decides it                                                                                                                                                           | Verdict                                                                                                                  |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Product Hunt          | n/a                 | maker identified; no vote asks                                                                                                                                                 | **Launch** (`01-product-hunt`), Tue 12-22                                                                                |
| X and Bluesky         | n/a                 | normal; the repo already has a Bluesky publish script                                                                                                                          | **Post** (`02-x-bluesky-thread`)                                                                                         |
| r/FreeEBOOKS          | 2,369,562           | link posts; "Your post must contain a link to a book that is LEGALLY available for free RIGHT NOW"; no affiliate links. The rule's title says "free **downloadable** books"    | **Ask the mods first** (`03-reddit-freeebooks`): it's free, but read online, not a file                                  |
| r/CriticalTheory      | 236,339             | no self-promotion rule listed; "submission quality"; event and reading-group announcements go in the monthly thread                                                            | Possible: one chapter with a real submission statement, after reading the sidebar. Not drafted                           |
| r/books               | 27,350,421          | "If you are posting your own content, you must meet all other /r/books rules, you must meet the 9:1 ratio, you must make it a self-post and you must be up front in the title" | Only if your Reddit history is 9 parts other activity to 1 part your own. Not drafted                                    |
| r/Buddhism            | 781,716             | own content OK "if it is non-commercial and on-topic, and you link to it only once"; no AI-generated responses                                                                 | Borderline: the book has an optional paid supporter tier and AI narration. Skip unless the mods say yes                  |
| r/Stoicism            | 837,571             | "only post promoted work in the Agora" (daily thread); limits AI-reliant content                                                                                               | A comment in the daily Agora thread only                                                                                 |
| r/philosophy          | 18,588,971          | "PR8: Self-posts, meta-posts, products, services… are not allowed"; "PR11: No AI-created/AI-assisted material allowed… Yes, that includes images" (ban)                        | **Out**. The AI art alone breaks PR11                                                                                    |
| r/askphilosophy       | 644,787             | "CR5: No self-promotion"                                                                                                                                                       | **Out**                                                                                                                  |
| r/suggestmeabook      | 3,424,260           | "Do not post anything you may financially benefit from in any perceived way… self promotions"                                                                                  | **Out**                                                                                                                  |
| r/Degrowth            | 35,658              | "No Ads or spam"; "No AI"                                                                                                                                                      | **Out**                                                                                                                  |
| r/Meditation, r/zen   | 3,569,441 / 140,258 | self-promotion banned "regardless of cost"; zen: nothing tenuously related                                                                                                     | **Out**                                                                                                                  |
| Goodreads             | n/a                 | listing usually needs an ISBN or ASIN (Author Program page); groups keep promotion in a "Self Promotion" folder                                                                | Check the Goodreads Librarian Manual on online-only books before adding it. Unverified whether a free web book qualifies |
| Hacker News (Show HN) | n/a                 | "For books, a sample chapter is ok"; the simulations and 3D map can be tried                                                                                                   | Fits, but the owner's HN account can't post a Show HN yet (see `../mushi-mushi/`). Hold                                  |

## Posts in this folder

| File                                                                            | Venue                             | When                             |
| ------------------------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| `rating-ask.en.paste.md`, `rating-ask.ja.paste.md` (rules: `../rating-asks.md`) | readers who wrote in; supporters  | Mon 12-21                        |
| `01-product-hunt.paste.md` + `.notes.md`                                        | Product Hunt                      | Tue 12-22, 00:01 PT (17:01 JST)  |
| `02-x-bluesky-thread.paste.md` + `.notes.md`                                    | X, then Bluesky                   | Wed 12-23, 00:30 UTC (09:30 JST) |
| `03-reddit-freeebooks.paste.md` + `.notes.md`                                   | r/FreeEBOOKS, **after a mod yes** | Sat 12-26, 14:00 UTC             |

## Media shot list

| Use                | File (the-wanting-mind repo, `origin/main`)                                                                                | Status    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------- |
| PH gallery 1       | **Record:** 20 s screen capture: open the concept map, fly to one node, tap it, land in the chapter passage.               | to record |
| PH gallery 2–5     | `distribution/play/screenshots/phone/01-free-to-read.png`, `02-read-aloud.png`, `04-concept-map.png`, `06-simulations.png` | exists    |
| X / Bluesky post 1 | the concept-map clip                                                                                                       | to record |
| X / Bluesky post 3 | `docs/screenshots/simulations-light.png`                                                                                   | exists    |
| r/FreeEBOOKS       | the link preview is the chapter's OG image (one shared `og-image.png`; per-chapter cards are an open audit item)           | exists    |

## Links (copy exactly)

| Venue                  | Link                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Hunt           | `https://kensaur.us/the-wanting-mind/en/preface?utm_source=producthunt&utm_medium=post&utm_campaign=launch-2611-ph`                                             |
| X                      | `https://kensaur.us/the-wanting-mind/en/preface?view=graph&utm_source=x&utm_medium=post&utm_campaign=launch-2611-x`                                             |
| Bluesky                | `https://kensaur.us/the-wanting-mind/en/preface?view=graph&utm_source=bluesky&utm_medium=post&utm_campaign=launch-2611-bsky`                                    |
| r/FreeEBOOKS           | `https://kensaur.us/the-wanting-mind/en/preface?utm_source=reddit&utm_medium=post&utm_campaign=launch-2611-freeebooks`                                          |
| Play (in replies)      | `https://play.google.com/store/apps/details?id=us.kensaur.thewantingmind&referrer=utm_source%3Dproducthunt%26utm_medium%3Dpost%26utm_campaign%3Dlaunch-2611-ph` |
| App Store (in replies) | `https://apps.apple.com/app/id6761361305?pt=128720195&ct=launch-2611-ph`                                                                                        |

## Check it worked

| When                      | What                                                  | Where                                                                                                                                                |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 h after the Reddit post | visible signed out at `/r/FreeEBOOKS/new/`            | private window                                                                                                                                       |
| Day 1, day 7              | chapter reads and concept-map opens from the campaign | the book's own analytics; Mushi Mushi TWM project sessions (total only; 83% of sessions were bots per the audit, so compare against the week before) |
| Day 7                     | installs by campaign                                  | Play Console; App Store Connect campaigns (5+ installs)                                                                                              |

**Gate before this week:** the landing has no App Store or Play button (audit).
The posts link the preface, which works without them. If the growth-twm lane
has shipped badges on chapter pages by then, mention the apps in replies;
otherwise give the store links from the table above.
