Pod::Spec.new do |s|
  s.name           = 'WaypointEmbed'
  s.version        = '0.1.0'
  s.summary        = 'On-device sentence embeddings for Waypoint search'
  s.description    = 'Wraps NLEmbedding.sentenceEmbedding so search vectors are made on the iPhone'
  s.author         = ''
  s.homepage       = ''
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
  s.exclude_files = 'Tests/**/*'
end
