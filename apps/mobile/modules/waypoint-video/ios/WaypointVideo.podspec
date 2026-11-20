Pod::Spec.new do |s|
  s.name           = 'WaypointVideo'
  s.version        = '1.0.0'
  s.summary        = 'Waypoint slide rendering for video overviews'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
  s.exclude_files  = 'Tests/**/*'
end
