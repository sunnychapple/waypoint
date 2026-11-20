Pod::Spec.new do |s|
  s.name           = 'WaypointSandbox'
  s.version        = '1.0.0'
  s.summary        = 'Waypoint locked web view for diagrams and mini apps'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
  s.exclude_files  = 'Tests/**/*'
  s.resource_bundles = { 'WaypointSandbox' => ['Resources/mermaid.min.js'] }
end
