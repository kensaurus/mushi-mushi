Pod::Spec.new do |s|
  s.name             = 'mushi_mushi'
  s.version          = '0.2.0'
  s.summary          = 'Flutter plugin for Mushi Mushi — LLM-driven bug intake & autofix.'
  s.description      = <<-DESC
    Mushi Mushi Flutter SDK — bottom-sheet bug reporter, shake-to-report,
    offline queue, and device context capture for Flutter apps on iOS.
  DESC
  s.homepage         = 'https://mushimushi.dev'
  s.license          = { :type => 'MIT', :file => '../LICENSE' }
  s.author           = { 'Mushi Mushi' => 'oss@mushimushi.dev' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency 'Flutter'
  s.platform         = :ios, '15.0'
  s.swift_versions   = ['5.9']
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
