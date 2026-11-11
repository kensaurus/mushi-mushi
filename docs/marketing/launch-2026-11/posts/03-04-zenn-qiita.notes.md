# Notes: Zenn and Qiita how-tos (never paste this file)

Paste files:
- `03-zenn-lovable-check.paste.md`: Zenn, the "check, add the button, fix"
  walk-through.
- `04-qiita-lovable-check.paste.md`: Qiita, a by-hand checklist, then the free
  check.

The two take different angles on purpose. Do not publish the same text on
both sites.

Line 1 is the title, and the rest is the body. Both bodies contain
**intentional code fences**:
- Zenn: one `text` block, the Lovable prompt with the script tag.
- Qiita: two `bash` blocks.

The grep gate's fence check will therefore match. That is expected: only check
that the body has no `Title (set`, `READY`, `Source notes` or
`Questions for the owner`.

## Zenn fields

Web editor, or zenn-cli front matter (official guide
https://zenn.dev/zenn/articles/zenn-cli-guide, read 2026-11-11):

```yaml
title: "Lovableで作ったアプリの壊れた箇所を無料で見つける"
emoji: "🐛"
type: "tech"
topics: ["lovable", "bolt", "個人開発", "ai", "mushimushi"]
published: true
```

- **5 topics.** The official guide states the 5-topic cap only for books. The
  article cap of 5 comes from third-party Zenn posts `[unverified official]`.
- **Turn on Zenn's English version** if the editor offers it. Zenn started
  experimental English generation on 2026-01-09 (research note §3.4,
  `[unverified current availability]`).

## Qiita fields

- **Title:** line 1 of the paste file.
- **Tags** (a maximum of 5 per article, from the official
  https://help.qiita.com/ja/articles/qiita-tag, read 2026-11-11):
  `Lovable` `Bolt` `個人開発` `AI` `初心者`.
- **Self-promotion rule** (Qiita community guideline): 「宣伝や販売を主目的とした
  記事投稿は…行わないでください。なお自社や自作の技術的な解説等を主目的としている
  記事は、宣伝や販売には当たりません。」
  - That is why the Qiita article is a by-hand checklist first, and the tool
    only appears after the five checks.

## Before posting

- [ ] **Production Check gate** (as in `01-data-story.notes.md`). Both
  articles say an unreachable site shows as a failure, and that visitor-facing
  breakage comes before security headers.
- [ ] Re-run `select public_scoreboard(60);` and update 34 / 18 / 2,031 / 523 / 2.
- [ ] **Zenn posting limit.** It is a rolling window of about 24 hours from
  your last publish (memory `zenn-posting-limit`).
  - Leave at least 24 hours since any other Zenn article.
  - Keep campsite, glot.it and livestream posts out of this tag set (research
    note §6 item 5).
- [ ] **After publishing,** read the article back through its API
  (`https://zenn.dev/api/articles?username=kensaurus&order=latest`, or Qiita's
  `GET /api/v2/items/:id`). Check that no notes text leaked into the body or
  the OG description.

## Facts behind the copy

- **Numbers:** `public_scoreboard(60)` at 2026-11-11 03:11 UTC. The split is in
  `01-data-story.notes.md`.
- **Steps** come from `apps/docs/content/quickstart/lovable-bolt.mdx`:
  - the script tag and prompt are copied verbatim;
  - "Generate API key" and "Copy fix prompt" are named there.
- **"ボタンはブラウザの言語に合わせて"**: `packages/web/src/i18n/index.ts` falls
  back to `navigator.language`, and the widget ships a `ja` locale.
- **The diagnosis language is not claimed as Japanese.** The article says "平易な
  英語".
- **The four example bugs:** from the owner's lead research, on public pages,
  with no app named.

## Kill switch

Fewer than 20 tagged views per article after 14 days, across 2 articles: stop
JP articles for this launch (research note play 9).
