require 'json'
version = JSON.parse(File.read(File.join(__dir__, '../../package.json')))['version']
Pod::Spec.new do |s|
  s.name = 'DirectSsh'
  s.version = version
  s.summary = 'Direct mobile SSH and SFTP sessions'
  s.homepage = 'https://codex.onepiper.cloud'
  s.license = { :type => 'Apache-2.0' }
  s.author = 'Codex Switch'
  s.platform = :ios, '15.1'
  s.source = { :path => '.' }
  s.source_files = 'DirectSsh.m'
  s.dependency 'React-Core'
  s.vendored_frameworks = 'build/DirectSsh.xcframework'
  s.frameworks = 'Security', 'SystemConfiguration'
  s.libraries = 'c++', 'resolv'
  unless system('node', File.join(__dir__, '../../scripts/build-direct-ssh.cjs'), 'ios')
    raise 'Direct SSH Rust build failed'
  end
end
