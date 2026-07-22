# @mushi-mushi/angular

Source: https://kensaur.us/mushi-mushi/docs/sdks/angular

---
title: '@mushi-mushi/angular'
---

# `@mushi-mushi/angular`

Angular DI providers over [`@mushi-mushi/web`](/sdks/web). Shared wrapper notes:
[Framework wrappers](/sdks/framework-wrappers).

```bash
npm install @mushi-mushi/angular
```

See [Quickstart → Angular](/quickstart/angular) for the full setup walkthrough.

## API surface

```ts

```

| Export | Purpose |
| --- | --- |
| `provideMushi(config)` | App-level provider — call in `bootstrapApplication` or `AppModule.providers` |
| `MushiService` | Injectable singleton — `submit()`, `identify()`, `submitActivity()` |
| `MushiReportDirective` | `mushiReport` attribute directive — attaches report trigger to any element |

## Setup (standalone bootstrap)

```ts
// main.ts

bootstrapApplication(AppComponent, {
  providers: [
    provideMushi({
      projectId: 'YOUR_PROJECT_ID',
      apiKey: 'YOUR_PUBLIC_API_KEY',
    }),
  ],
})
```

## Identifying users

```ts
// auth.service.ts

@Injectable({ providedIn: 'root' })

  private readonly mushi = inject(MushiService)

  onSignIn(user: { id: string; email: string; name: string }) {
    this.mushi.identify(user.id, { email: user.email, name: user.name })
  }
}
```

## Submitting a report

```ts

@Component({ ... })

  private readonly mushi = inject(MushiService)

  async reportIssue() {
    await this.mushi.submit({ title: 'Something feels off', severity: 'p2' })
  }
}
```
