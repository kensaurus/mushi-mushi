# Mushi Mushi — Node server starter

```bash
npm install
cp .env.example .env       # then fill in the two vars, or run: npx mushi-mushi
npm start                  # then: curl localhost:3000/boom
```

`/boom` throws asynchronously; the unhandled hook forwards the crash to Mushi.
Express / Fastify / Hono error-handler middlewares are documented at
https://kensaur.us/mushi-mushi/docs/sdks/node
