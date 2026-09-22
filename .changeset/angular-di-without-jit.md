---
'@mushi-mushi/angular': patch
---

The Angular SDK works as documented in AOT apps. `provideMushi(config)` now returns `EnvironmentProviders`, so `providers: [provideMushi(...)]` type-checks and bootstraps (it used to return a plain object that threw "Invalid provider"). Every provider is an explicit factory with explicit deps, so DI no longer needs the JIT compiler that `ng build` apps do not load. The old `service` / `errorHandler` properties stay as lazy accessors on the same DI instance, and `provideMushiAngular()` returns the same providers as a spreadable list.
