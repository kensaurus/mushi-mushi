Pod::Spec.new do |s|
  s.name             = 'MushiMushi'
  s.version          = '0.2.0'
  s.summary          = 'Native iOS SDK for the Mushi Mushi LLM-driven bug intake & autofix platform.'
  s.description      = <<-DESC
    MushiMushi is an LLM-driven bug intake, classification, and autofix
    platform. This pod provides the native iOS SDK: shake-to-report,
    screenshot capture, offline queue, device context, and an optional
    Sentry bridge that mirrors reports into Sentry's UserFeedback channel.
  DESC

  s.homepage         = 'https://github.com/kenroy/mushi-mushi'
  s.license          = { :type => 'MIT', :file => 'LICENSE' }
  s.author           = { 'Mushi Mushi' => 'kensaurus@gmail.com' }
  s.source           = {
    :git => 'https://github.com/kenroy/mushi-mushi.git',
    :tag => "ios-v#{s.version}"
  }
  s.documentation_url = 'https://docs.mushimushi.dev/sdks/ios'

  s.ios.deployment_target  = '15.0'
  s.tvos.deployment_target = '15.0'
  s.swift_versions   = ['5.9']

  s.default_subspec  = 'Core'

  s.subspec 'Core' do |core|
    core.source_files = 'Sources/MushiMushi/**/*.swift'
    core.frameworks   = 'Foundation', 'UIKit'
  end

  s.subspec 'Sentry' do |sentry|
    sentry.source_files = 'Sources/MushiMushiSentry/**/*.swift'
    sentry.dependency 'MushiMushi/Core'
    sentry.dependency 'Sentry', '~> 8.0'
  end
end
