# Walkthrough videos: post drafts (owner posts; not posted yet)

Drafted 2026-11-03 for the docs page https://kensaur.us/mushi-mushi/docs/how-it-works
(shipped in PR #1010). One external post per release: pick **one** of Zenn or
note for the Japanese post, plus the X reply and the LinkedIn post. Each needs
the owner's go-ahead and the owner's account. Proofread for a bare "Mushi"
before posting (always "Mushi Mushi").

Zenn's posting window is a rolling ~24 h from the last publish; check
`https://zenn.dev/api/articles?username=kensaurus&order=latest` first.

Attach: the poster images in `apps/docs/public/walkthroughs/*.jpg`, or a
screen recording of the page. The clips themselves are MP4 on the docs site;
link to the page instead of uploading them.

UTM: `?utm_source=<zenn|note|x|linkedin>&utm_medium=social&utm_campaign=walkthroughs-2026-11`

## Zenn / note (Japanese)

**Title:** Mushi Mushi の使い方を、クリックの順番そのまま動画にしました

```text
Mushi Mushi のドキュメントに、短い動画を4本入れました。

自分でドキュメントを読み返して困ったのは、「どこを押せばいいか」が文章だと伝わらないことでした。設定の画面は文字で説明すると長くなるのに、見ればすぐ分かります。なので、実際の画面を録画して、押す場所にカーソルと説明を重ねました。

4本の中身:

1. アプリを使っている人がバグを報告するところ(ボタン1つ、一文だけ)
2. 届いた報告に付く、平易な言葉の原因の説明と、エディタに渡す修正プロンプト。そこから実際にマージされたプルリクエストまで
3. Cursor や Claude Code をつなぐ手順
4. 修正がデプロイされるまでを追う画面と、自分の判断が必要なものの見つけ方

コンソールの動画は Mushi Mushi 自身の本物のバグとプルリクエストです。最初の1本だけは「あなたのアプリの利用者が見る画面」なので、架空のお店のアプリを使っています。

同じページに、いまのバグ管理でつらいところと、それぞれに Mushi Mushi が何をするかの表も置きました。「動かない」とだけ言われて何から見ればいいか分からない、AI に直させても文脈がなくて当てずっぽうになる、エージェントのプルリクエストが溜まって全部は読めない、といったところです。

まだ荒いところもあります。動画は英語の画面で、日本語の字幕はまだありません。

ページはこちらです:
https://kensaur.us/mushi-mushi/docs/how-it-works?utm_source=zenn&utm_medium=social&utm_campaign=walkthroughs-2026-11

どの手順が分かりにくかったか、コメントで教えてもらえると次の動画に反映します。
```

note: same text, swap `utm_source=zenn` for `utm_source=note`, hashtags
`#個人開発 #生成AI #バグ #ClaudeCode #Cursor #オープンソース`.

## X (reply under the 2026-10-29 post, or a standalone post)

```text
I added four short videos to the Mushi Mushi docs. Each one shows the real screen, with the cursor on what to press: a user reporting a bug, the plain-English diagnosis and fix prompt, connecting Cursor or Claude Code, and the fix shipping.

The console clips are Mushi Mushi's own real bugs and PRs.

https://kensaur.us/mushi-mushi/docs/how-it-works?utm_source=x&utm_medium=social&utm_campaign=walkthroughs-2026-11
```

## LinkedIn

```text
Docs for a developer tool usually explain the setup in text. I kept rereading mine and noticed the hard part was always "which button do I press now", which a screenshot answers faster than a paragraph.

So the Mushi Mushi docs now have four short screen recordings, with the cursor and a caption on each click:

1. A user reporting a bug from inside an app
2. The plain-English diagnosis, the fix prompt for your editor, and the pull request that fixed it
3. Connecting Cursor or Claude Code
4. Following a fix to the deploy, and spotting the ones that need you

The console clips show Mushi Mushi's own bugs and pull requests, so everything in them is real and public. The same page has a table of the bug-tracking problems I kept hitting as a solo builder with AI-written code, and what Mushi Mushi does about each.

https://kensaur.us/mushi-mushi/docs/how-it-works?utm_source=linkedin&utm_medium=social&utm_campaign=walkthroughs-2026-11

If one of the steps is still unclear, tell me which, and I'll record it next.
```

## Checklist before posting

- [ ] Owner approved the text and the channel
- [ ] The page loads and the videos play on a phone (check after the next docs deploy)
- [ ] No bare "Mushi" in the final text
- [ ] Add the row to `log/README.md` with the live URL and a cropped screenshot
