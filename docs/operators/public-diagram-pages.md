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
| Same URL with no object (store not configured, write failed, never published) | The bucket's 404 document. Once `scripts/aws-configure-docs-errors.mjs` has pointed it at the docs `404.html`, the docs `not-found` page renders the diagram client-side (best-effort, status 404). **As of 2026-10-02 that is not set up on kensaur.us: a missing key returns the raw S3 `NoSuchKey` page.** | No |
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
api writes plain static files instead. Publish and unpublish change the files at
once. The objects carry `Cache-Control: public, max-age=300`; how long an
edge keeps serving a deleted page depends on the `/mushi-mushi/*` cache
behavior's cache policy (its minimum and maximum TTL). With a policy that
honors origin headers, that is at most five minutes. Check the live
behavior's policy before promising a takedown time; an invalidation of
`/mushi-mushi/r/<owner>/<repo>*` removes it at once.

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
   "not_configured"`, `public_repo_diagrams.static_page_at` stays NULL, and
   every link and README badge points at the interactive docs view
   (`/mushi-mushi/docs/r?repo=<owner>/<repo>`), which always works. Search
   engines don't index it. The console tells the owner.
3. Deploy the admin site. `deploy-admin.yml` republishes the CloudFront router
   with rule 0c.
4. **Owner action: give missing pages a real 404.** See the next section.
   Without it, an unpublished or not-yet-written `/r/` URL shows S3's raw
   `NoSuchKey` page (still status 404, but unbranded and naming the key).

## Owner action: a branded 404 for missing pages

On 2026-10-02 `curl -sI https://kensaur.us/mushi-mushi/docs/<missing>`
returned S3's raw `NoSuchKey` page. The bucket's website ErrorDocument is
`index.html`, a key that does not exist. This affects every missing key in
`kensaur.us-mushi-mushi`, not only diagram pages.

The fix is already in the repo, but the deploy role cannot run it:

- **Why the bucket, and not CloudFront.** A CloudFront Function cannot
  supply it: viewer-request cannot see whether an object exists, and
  viewer-response never runs when the origin answers 400 or above.
  Distribution-level custom error responses are deliberately not used,
  because the distribution serves every kensaur.us app.
- **Same origin.** `/mushi-mushi/docs/*` was cloned from the `/mushi-mushi/*`
  behavior (`scripts/cloudfront-create-docs-behavior.sh`), so both use the
  same S3 website origin. One per-bucket ErrorDocument covers docs paths and
  `/r/` paths alike.
- **Status stays 404.** S3 serves the error document with status 404, never
  a 200 soft-404. For `/r/<owner>/<repo>` the docs `not-found` page then
  renders the diagram client-side, best-effort.

Steps, with AWS credentials that have `s3:GetBucketWebsite`,
`s3:PutBucketWebsite` on the bucket plus `cloudfront:ListResponseHeadersPolicies`,
`GetResponseHeadersPolicy`, `CreateResponseHeadersPolicy`,
`UpdateResponseHeadersPolicy`, `GetDistributionConfig` and `UpdateDistribution`
(an account admin; the GitHub deploy role has only the last two):

1. `node scripts/aws-configure-docs-errors.mjs --dry-run` and read the planned changes.
2. `node scripts/aws-configure-docs-errors.mjs` (idempotent).
3. Set the repository variable `DOCS_ERROR_PAGES_CONFIGURED=true`
   (`gh variable set DOCS_ERROR_PAGES_CONFIGURED --body true`) so every docs
   deploy smoke-checks it from then on.
4. Check: `curl -sI https://kensaur.us/mushi-mushi/docs/__missing` returns
   `404` with the docs page, no `NoSuchKey`, and a `strict-transport-security`
   header. `curl -sI https://kensaur.us/mushi-mushi/r/nobody/nothing` returns
   `404` (after the admin deploy ships router rule 0c).

Verify: publish a diagram of a repo the project token can push to, then run:

```bash
curl -sI https://kensaur.us/mushi-mushi/r/<owner>/<repo>     # 200, text/html
curl -s  https://kensaur.us/mushi-mushi/r/<owner>/<repo>.md  # the Markdown twin
```

Then unpublish. Once the edge cache expires (see above), the first URL
returns 404.

## Takedown runbook

When someone reports a diagram that must come down and the owner can't be
reached:

1. Delete the row: `DELETE FROM public_repo_diagrams WHERE lower(repo_owner) = '<owner>' AND lower(repo_name) = '<repo>';`
   (service role; this is a production data change, so confirm first).
2. Delete both files:
   `aws s3 rm s3://kensaur.us-mushi-mushi/mushi-mushi/r/<owner>/<repo>.html`
   and the same key with `.md` (lowercase).
3. Invalidate `/mushi-mushi/r/<owner>/<repo>*` on the distribution.

**Do not remove the `MUSHI_PUBLIC_PAGES_*` secrets while pages are live.**
Unpublish and project delete can then no longer delete the files, and the
pages stay up until someone removes them by hand. Deleting a project removes
its page first (best-effort, logged on failure).

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
