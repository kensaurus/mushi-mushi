---
'@mushi-mushi/cli': patch
---

`mushi runner bill` now tells you how to fix a refused personal bill: the token `gh auth login` makes is a classic token, which reads billing only with the `user` scope, so run `gh auth refresh -s user` once. The help text says the same.
