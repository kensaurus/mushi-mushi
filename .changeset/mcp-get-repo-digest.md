---
"@mushi-mushi/mcp": minor
---

Add `get_repo_digest`: the connected GitHub repo as one paste-ready text digest at a pinned commit (tree plus ranked files, cut to a token budget), scoped to a folder or to the files one bug touches. It needs no codebase index, ships on the default feature set, and wraps its output as untrusted data. `.env` files and keys are never included, and a file that looks like it holds a secret is replaced with a notice.
