# Attribution

These fixtures implement the **RealWorld ("Conduit") specification** by
[Thinkster / gothinkster](https://github.com/gothinkster/realworld), published
under the MIT License. "Conduit" — the Medium-clone demo app, its API contract
(`Authorization: Token <jwt>`, `{"errors":{"body":[...]}}` error shape,
`limit`/`offset` pagination, `?tag=`/`?author=`/`?favorited=` filters) and its
route map (`#/login`, `#/article/:slug`, `#/profile/:username`) — is their
design.

The implementations in this directory are compact, spec-conformant fixtures
authored for the Mushi Mushi repository (MIT, same as the rest of this repo)
rather than verbatim copies of a reference codebase. They exist to exercise the
Mushi SDKs against the spec's realistic behaviors hermetically: no network
access, no database, pinned workspace dependencies.

RealWorld spec: https://realworld-docs.netlify.app/
RealWorld license: MIT © Thinkster
