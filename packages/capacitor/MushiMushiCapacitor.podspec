require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'MushiMushiCapacitor'
  s.version          = package['version']
  s.summary          = package['description']
  s.license          = package['license']
  s.homepage         = package['repository']['url']
  s.author           = package['author']
  s.source           = { :git => package['repository']['url'], :tag => "capacitor-v#{s.version}" }
  # The core iOS SDK is vendored into ios/MushiMushi by
  # scripts/sync-native-sources.mjs (prepack), exactly as Package.swift uses
  # it, and compiled into this pod. There is no MushiMushi pod on CocoaPods
  # trunk, so depending on one made `pod install` / `npx cap sync ios` fail.
  # One pod is one Swift module, which is why MushiMushiPlugin.swift guards
  # `import MushiMushi` with canImport (SwiftPM keeps two targets).
  s.source_files     = 'ios/Plugin/**/*.{swift,h,m}', 'ios/MushiMushi/Sources/MushiMushi/**/*.swift'
  s.ios.deployment_target = '15.0'
  s.swift_versions   = ['5.9']

  s.dependency 'Capacitor'
end
