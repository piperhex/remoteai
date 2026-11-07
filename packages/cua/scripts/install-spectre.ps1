param([ValidateSet('x64', 'arm64')][string]$Architecture = 'x64')
$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath
if (-not $installation) { throw 'Visual C++ Build Tools were not found' }
$compiler = Get-ChildItem (Join-Path $installation 'VC\Tools\MSVC') -Directory |
    Sort-Object Name -Descending | Select-Object -First 1
if (Test-Path (Join-Path $compiler.FullName "lib\spectre\$Architecture\libcmt.lib")) { exit 0 }
$component = if ($Architecture -eq 'arm64') {
    'Microsoft.VisualStudio.Component.VC.Runtimes.ARM64.Spectre'
} else {
    'Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre'
}
$installer = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
$arguments = @('modify', '--installPath', "`"$installation`"", '--add', $component, '--quiet', '--norestart')
$process = Start-Process $installer -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -notin @(0, 3010)) { throw "Visual C++ component installation failed: $($process.ExitCode)" }
$compiler = Get-ChildItem (Join-Path $installation 'VC\Tools\MSVC') -Directory |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not (Test-Path (Join-Path $compiler.FullName "lib\spectre\$Architecture\libcmt.lib"))) {
    throw 'The required Spectre libraries are still missing'
}
