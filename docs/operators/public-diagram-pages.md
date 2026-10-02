# Public architecture-diagram pages

A project owner can publish the AI architecture diagram of a repo at
`https://kensaur.us/mushi-mushi/r/<owner>/<repo>` (console: **Explore → Map →
Diagram → Public page**). This page is for whoever runs Mushi Cloud or a
self-host: what gets served, what has to be set up once, and the decisions
behind it.

## What is served where

| URL | Served by | Indexed |
|---|---|---|
| `/mushi-mushi/r/<owner>/<repo>` | `mushi-mushi/r/<owner>/<repo>.html` in the docs S3 bucket, written by the `api` function on publish | Yes (`robots: index`, canonical, `SoftwareSourceCode` JSON-LD) |
| `/mushi-mushi/r/<owner>/<repo>.md` | `mushi-mushi/r/<owner>/<repo>.md`, written with it | Linked as `rel="alternate" type="text/markdown"` |
| Same URL with no object (store not configured, write failed, never published) | The bucket's 404 document: the docs `not-found` page renders the diagram client-side from `GET /v1/public/diagrams/:owner/:repo` | No: the status stays 404 |
| `/mushi-mushi/docs/r?repo=<owner>/<repo>` | The docs static shell (interactive view) | No (`noindex`) |

The CloudFront router (`scripts/cloudfront-mushi-spa-router.js`, rule 0c)
rewrites `/mushi-mushi/r/<owner>/<repo>[.md]` to the lowercase keys. Keys are
lowercase because GitHub names are case-insensitive.

**Why static files, and not an edge function:** the docs site is a static
export, so it cannot have per-repo HTML for repos published after its last
build. Supabase Edge Functions rewrite `GET` responses with `Content-Type:
text/html` to `text/plain`
([Supabase docs](https://supabase.com/docs/guides/functions/http-methods)).
Overriding that header at CloudFront would sidestep a platform rule, so the
api writes plain static files instead. Publish and unpublish take effect at
once. The objects carry `Cache-Control: public, max-age=300`, so an
unpublished page is gone from every edge within five minutes.

## One-time setup

1. Create an IAM user, or a role the function can assume, with only this
   policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::kensaur.us-mushi-mushi/mushi-mushi/r/*"
       }
     ]
   }
   ```

2. Set four secrets on the Supabase project (names only shown here):
   `MUSHI_PUBLIC_PAGES_BUCKET`, `MUSHI_PUBLIC_PAGES_REGION`,
   `MUSHI_PUBLIC_PAGES_ACCESS_KEY_ID`, `MUSHI_PUBLIC_PAGES_SECRET_ACCESS_KEY`.
   Until all four exist, the publish response says `static_page:
   "not_configured"` and the console tells the owner. The page still works
   through the 404 fallback; search engines just don't index it.
3. Deploy the admin site. `deploy-admin.yml` republishes the CloudFront router
   with rule 0c.
4. The 404 fallback needs the bucket's 404 document set up (see
   `scripts/aws-configure-docs-errors.mjs`); deploy-docs smoke-checks it.

Verify: publish a diagram of a repo the project token can push to, then run:

```bash
curl -sI https://kensaur.us/mushi-mushi/r/<owner>/<repo>     # 200, text/html
curl -s  https://kensaur.us/mushi-mushi/r/<owner>/<repo>.md  # the Markdown twin
```

Then unpublish. Within five minutes the first URL returns 404.

## Who can publish, and what becomes public

- **Who:** a project owner or admin, using a project GitHub token with push,
  maintain or admin permission on the repo, as GitHub reports it for that
  token. Reading a public repo is not ownership, so this blocks publishing a
  page about someone else's repo. A private repo also needs a consent tick on
  the exact preview, and one repo has one page. The publish call carries the
  hash of the payload the owner previewed, so a redraw in between is refused.
- **What:** part names, one-line descriptions, folder or file paths that exist
  at the published commit, connection labels, and the commit. Never file
  contents. Redrawing does not change a live page until the owner publishes
  again; the console shows "Update public page" when they differ.
- **Takedown:** "Report a wrong or unwanted diagram" goes into Mushi's own
  report queue through the docs site's Mushi SDK (category `other`, with repo,
  commit and part). Without the SDK (no analytics consent, or on the static
  page), it opens a prefilled email to the product inbox. It never opens a
  public issue, because a takedown request can itself contain what someone
  wants removed.

## Decision: no regeneration on push

Diagrams are drawn only when a person asks: **Draw diagram**, **Redraw**,
**Update to latest commit**, or the `POST /codebase/diagram` route. Drawing on
every push was considered and left off:

- **Cost:** one LLM call per push per project, mostly for commits that change
  nothing architectural. Plan 020 §13 caps diagram runs at on-demand or per
  release.
- **Trust:** a public page that changes on its own would publish content its
  owner never previewed. Published pages are frozen copies on purpose.
- **Signal:** push indexing does not run for PAT-only projects today (Plan 020
  §10.2, blocker 4), so a push hook would fire for almost no one.

Revisit when push indexing works for every project, and only for the private
console diagram, never the public page.
