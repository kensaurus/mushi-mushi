---
'@mushi-mushi/node': patch
---

- **Hono and Fastify reports drop URL query values**: the error handlers scrub query values (tokens, emails) from the request URL before putting it into the report description, as the Express handler already did.
