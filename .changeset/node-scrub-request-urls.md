---
'@mushi-mushi/node': patch
---

The Hono and Fastify error handlers scrub query values (tokens, emails) from the request URL before putting it into the report description, as the Express handler already did.
