# "Add a bug-report button to your Lovable app in 2 minutes" — guide outline

Goal: a Lovable builder with no terminal gets their first real user report
diagnosed. (Activation event: first report from a non-localhost origin.)

1. Sign in to Mushi with GitHub → it creates your app and a key.
2. In Lovable, paste one prompt: "Add this script tag before </body> and set
   these two values" (the CDN script tag from quickstart/web.mdx, key filled in).
3. Publish in Lovable. Open your live site, tap the bug button, send a test.
4. Watch it arrive in Mushi with a plain-English diagnosis.
5. Optional: connect your GitHub repo (Lovable's GitHub sync) so fixes come
   back as pull requests Lovable can pull in.
6. Optional: add Mushi as an MCP connector in Claude Code or Cursor to ask
   "why is this broken?" in your editor.

Checks before publishing the guide: the paste works on a fresh Lovable
project end to end; the CDN snippet's CSP note is right for Lovable hosting;
screenshots from a real run.
