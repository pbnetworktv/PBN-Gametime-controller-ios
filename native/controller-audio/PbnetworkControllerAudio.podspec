require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'PbnetworkControllerAudio'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://pbnetwork.tv'
  s.author = package['author']
  s.source = { :git => 'https://github.com/pbnetworktv/PBN-Gametime-controller-ios.git', :tag => package['version'] }
  s.source_files = 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '15.0'
  s.frameworks = 'AVFoundation'
  s.dependency 'Capacitor', '~> 8.0'
  s.swift_version = '5.1'
end
