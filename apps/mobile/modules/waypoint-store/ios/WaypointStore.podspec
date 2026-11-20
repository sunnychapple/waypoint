Pod::Spec.new do |s|
  s.name           = 'WaypointStore'
  s.version        = '1.0.0'
  s.summary        = 'Waypoint StoreKit 2 purchases'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
end
