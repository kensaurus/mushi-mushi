Pod::Spec.new do |s|
  s.name             = 'MushiMushi'
  s.version          = '0.4.0'
  s.summary          = 'Native iOS SDK for Mushi Mushi: one place to improve AI-built apps.'
  s.description      = <<-DESC
    Mushi Mushi is one place to improve AI-built apps: fix bugs, smooth
    user journeys and clean up the code. This pod provides the native iOS
    SDK: shake-to-report, screenshot capture, offline queue, device
    context, native bottom-sheet widget, breadcrumb ring buffer, rage-tap /
    slow-screen proactive detection, PII scrubbing, and exception
    normalisation.
  DESC

  s.homepage         = 'https://github.com/kensaurus/mushi-mushi'
  s.license          = { :type => 'MIT', :file => 'LICENSE' }
  s.author           = { 'Mushi Mushi' => 'kensaurus@gmail.com' }
  s.source           = {
    :git => 'https://github.com/kensaurus/mushi-mushi.git',
    :tag => "ios-v#{s.version}"
  }
  s.documentation_url = 'https://kensaur.us/mushi-mushi/docs/sdks/ios'

  s.ios.deployment_target  = '15.0'
  s.tvos.deployment_target = '15.0'
  s.swift_versions   = ['5.9']

  s.source_files = 'Sources/MushiMushi/**/*.swift'
  s.frameworks   = 'Foundation', 'UIKit'
end
