# Mushi docs playground

Each subfolder is a self-contained, runnable demo that StackBlitz boots
inside a WebContainer when readers click **Try it live** in the docs.

The docs `<Playground scenario="..." />` MDX component points at one of
these folders via a `stackblitz.com/github/...` URL — there is no
deploy step, just commit and push.

## Add a new scenario

```bash
mkdir apps/docs/playground/my-demo
cd apps/docs/playground/my-demo
# minimal: package.json + index.html (or vite.config + src/)
```

Use a public **demo** `reporterToken`. Never commit a real customer
token. The demo project on Mushi Cloud is sandbox-mode and resets
nightly.
