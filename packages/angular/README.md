# @mushi-mushi/angular

> **Your AI wrote it. Mushi Mushi tells you why it broke.**

Adds a bug-report widget to your Angular app (17 or later). When a user reports
a problem, [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) gets a
screenshot, the route and recent console and network events, explains the
cause in plain English, and hands your editor a fix to start from.

Add `provideMushi(config)` to your app's providers once. It also sends
uncaught errors to Mushi through Angular's `ErrorHandler`. It pulls in
`@mushi-mushi/web` for the widget, so do not call `Mushi.init()` separately.

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

`import.meta.env` works in Vite-based Angular setups. In an Angular CLI app, read the project ID and key from your `environments/environment.ts` file instead.

Docs: [Angular SDK](https://kensaur.us/mushi-mushi/docs/sdks/angular) ·
[Quickstart](https://kensaur.us/mushi-mushi/docs/quickstart/angular) ·
[Credentials](https://kensaur.us/mushi-mushi/docs/concepts/credentials)

## License

MIT
