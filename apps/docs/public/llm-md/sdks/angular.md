# @mushi-mushi/angular

Source: https://kensaur.us/mushi-mushi/docs/sdks/angular

---
title: '@mushi-mushi/angular'
description: API reference for @mushi-mushi/angular — MushiService, MushiErrorHandler and the MUSHI_CONFIG token, wired with factory providers in an Angular 17+ app.
---

# `@mushi-mushi/angular`

Angular service and error handler over [`@mushi-mushi/web`](/sdks/web). Shared
wrapper notes: [Framework wrappers](/sdks/framework-wrappers).

```bash
npm install @mushi-mushi/angular
```

See [Quickstart → Angular](/quickstart/angular) for the full setup walkthrough.

## API surface

```ts
import { MUSHI_CONFIG, MushiService, MushiErrorHandler } from '@mushi-mushi/angular'
```

| Export | Purpose |
| --- | --- |
| `MUSHI_CONFIG` | `InjectionToken` holding your project ID and public API key |
| `MushiService` | Starts the web SDK when constructed in the browser; `report({ description, category, metadata })` and `captureError(error, context)` |
| `MushiErrorHandler` | An `ErrorHandler` that forwards uncaught errors to `MushiService.captureError` |
| `provideMushi(config)` | Legacy helper that returns `{ service, errorHandler }` objects — not Angular providers, so do not put it in a `providers` array |
| `provideMushiAngular(config)` | Returns a class provider for `MushiService`, which needs the JIT compiler — avoid in production builds |

## Setup (standalone bootstrap)

  Register `MushiService` with `useFactory`, as below. The package ships
  without Angular's ahead-of-time metadata, so a plain class provider asks for
  the JIT compiler and fails at bootstrap in a production build.

```ts
// main.ts
import { ErrorHandler } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { MUSHI_CONFIG, MushiErrorHandler, MushiService, type MushiConfig } from '@mushi-mushi/angular'
import { AppComponent } from './app/app.component'
import { environment } from './environments/environment'

bootstrapApplication(AppComponent, {
  providers: [
    { provide: MUSHI_CONFIG, useValue: { projectId: environment.mushiProjectId, apiKey: environment.mushiApiKey } },
    { provide: MushiService, useFactory: (config: MushiConfig) => new MushiService(config), deps: [MUSHI_CONFIG] },
    { provide: ErrorHandler, useFactory: (mushi: MushiService) => new MushiErrorHandler(mushi), deps: [MushiService] },
  ],
})
```

The SDK starts when Angular first resolves `ErrorHandler`, which happens during
bootstrap. On the server (Angular SSR) `MushiService` skips initialisation.

## Submitting a report

```ts
import { Component, inject } from '@angular/core'
import { MushiService } from '@mushi-mushi/angular'

@Component({ selector: 'app-feedback-button', template: '<button (click)="reportIssue()">Report</button>' })
export class FeedbackButtonComponent {
  private readonly mushi = inject(MushiService)

  async reportIssue() {
    await this.mushi.report({ description: 'Something feels off', category: 'bug' })
  }
}
```

## Identifying users

`MushiService` has no identify method. Use the web SDK instance directly (add
`@mushi-mushi/web` to your own dependencies first, because pnpm will not
resolve it through the Angular package):

```ts
import { Mushi } from '@mushi-mushi/web'

Mushi.getInstance()?.setUser({ id: user.id, email: user.email })
```
