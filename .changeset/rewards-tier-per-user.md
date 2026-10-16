---
"@mushi-mushi/web": patch
---

`Mushi.getTier()` no longer answers one user's rewards tier for another. The tier was cached for 5 minutes without noting whose it was, so when one person signed out and another signed in on the same page, the second person saw the first person's tier and badge until the cache expired. The cache is now kept per user.
