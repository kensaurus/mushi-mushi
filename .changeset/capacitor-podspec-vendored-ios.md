---
'@mushi-mushi/capacitor': patch
---

`pod install` and `npx cap sync ios` work. The podspec depended on a `MushiMushi` pod that is not published on CocoaPods trunk, so installing the plugin in an iOS app failed. The pod now compiles the iOS SDK sources that ship inside this package, the same sources the Swift Package Manager build uses. The README's setup example uses the project API key (`mushi_…`) from **Projects → API Keys**, the same key as the web SDK.
