# @mushi-mushi/angular

> **Your AI wrote it. Mushi tells you why it broke.**

Angular — `provideMushi(config)` (or `provideMushiAngular`) once. Pulls in
`@mushi-mushi/web` for the Shadow DOM widget; do not call `Mushi.init()` separately.

```bash
npm install @mushi-mushi/angular
# or: npx mushi-mushi
```

```ts
import { provideMushi } from '@mushi-mushi/angular'

bootstrapApplication(AppComponent, {
  providers: [
    provideMushi({
      projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
      apiKey: import.meta.env.VITE_MUSHI_API_KEY,
    }),
  ],
})
```

Docs: [Angular SDK](https://kensaur.us/mushi-mushi/docs/sdks/angular) ·
[Quickstart](https://kensaur.us/mushi-mushi/docs/quickstart/angular) ·
[Credentials](https://kensaur.us/mushi-mushi/docs/concepts/credentials)

## License

MIT
