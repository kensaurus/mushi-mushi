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
  s.source_files     = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.swift_versions   = ['5.9']

  # Reuse the standalone iOS SDK so the offline queue, API client, shake
  # detection, and bottom-sheet widget are shared with native consumers.
  s.dependency 'Capacitor'
  s.dependency 'MushiMushi', '~> 0.2'
end
