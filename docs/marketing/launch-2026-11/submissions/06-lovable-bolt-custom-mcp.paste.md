How to ask Lovable or Bolt "what did my users report?"

Your app is live. Someone says it's broken. Lovable and Bolt can both connect to outside tools through MCP, the standard way AI apps talk to other services. This guide connects them to Mushi Mushi, so you can ask the chat what your users reported and get a fix, without copying anything between tabs.

You need two things first:

- A free Mushi Mushi account.
- The Mushi Mushi report button in your app. In Lovable or Bolt that is one prompt: https://kensaur.us/mushi-mushi/docs/quickstart/lovable-bolt?src=lovable.howto

No reports yet? Step 4 shows how to file a test one.

## Lovable

Custom MCP servers work on every Lovable plan.

1. Open Connectors (https://lovable.dev/dashboard?connectors), select **Add custom** at the top right, then **MCP server**.
2. Fill in the form:
   - **Server name:** Mushi Mushi
   - **Connection** (only some workspaces show it): Direct connection
   - **Server URL:** https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe
   - **Authentication:** OAuth (the default)
3. Click **Add & authorize**. A Mushi Mushi page opens. Sign in, pick the apps Lovable may see, and click **Approve**. There is no key to copy, and you can revoke access any time in the Mushi Mushi console.
4. In a project chat, ask:
   - "Using Mushi Mushi, what did my users report this week?"
   - "Get the fix context for the checkout report and fix it."
   - No reports yet? "Using Mushi Mushi, file a test report: 'The Save button on the settings page does nothing.'"

Lovable runs the read-only steps without asking. Before anything that changes something (marking a report fixed, replying to the person who reported it, filing a report), it shows an approval card.

If **MCP server** is greyed out, a workspace admin has turned custom servers off. Ask them to turn on **Custom MCP** in the Connectors admin settings.

## Bolt

We have not tested this in Bolt yet. These steps follow Bolt's own help page.

1. In the Bolt chatbox, click the **+** icon, then **Connectors**, then **Manage connectors**.
2. On the Connectors page, click **Custom MCP server** and fill in:
   - **Name:** Mushi Mushi
   - **URL:** https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe
   - **Transport type:** HTTP
   - **Authentication:** MCP OAuth
3. Click **Connect** and sign in on the Mushi Mushi page that opens.
4. Turn it on for your project: chatbox **+**, then **Connectors**, then the toggle next to Mushi Mushi.
5. Ask the same questions as in Lovable.

Bolt also has Sentry as a built-in connector. Sentry tells you what your code threw. Mushi Mushi starts from what a person reported and from what your live site shows, and you can use both.

## If something goes wrong

- **Sign-in shows "404":** use the kensaur.us URL above exactly.
- **"Tool is not enabled for this connection":** the `?features=vibe` part keeps the list to the 12 tools this needs. Remove it to get the full set.
- **Can't use OAuth:** choose "Bearer token or API key" in Lovable, or "API key" in Bolt, and paste a Mushi Mushi key with MCP access from the console. Sign-in is safer, because its key is made for this one connection.

Not sure anything is broken yet? Check your live site free, no sign-up: https://kensaur.us/mushi-mushi/docs/check?src=lovable.howto
