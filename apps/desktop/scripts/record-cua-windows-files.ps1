param([Parameter(Mandatory = $true)][string]$ArchiveDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = Join-Path $PSScriptRoot '../src-tauri/src/computer_use'
$assets = Get-Content -LiteralPath (Join-Path $source 'assets.rs') -Raw
$module = Get-Content -LiteralPath (Join-Path $source 'mod.rs') -Raw
$version = [regex]::Match($module, 'const VERSION: &str = "([^"]+)"').Groups[1].Value
$names = @('cua-driver.exe', 'cua-driver-uia.exe', 'cua-cursor-theme.exe',
    'cua_driver_sdk.dll', 'cua_driver_node_runtime.node', 'cua_driver_abi.h')
$targets = [ordered]@{}
foreach ($target in @('windows-x86_64', 'windows-arm64')) {
    $archive = Join-Path $ArchiveDirectory "$target.zip"
    $expected = [regex]::Match($assets, ('"' + $target + '",\s*"([a-f0-9]{64})"')).Groups[1].Value
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        throw "Archive checksum mismatch: $target"
    }
    $zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $archive))
    try {
        $files = [ordered]@{}
        foreach ($name in $names) {
            $entries = @($zip.Entries | Where-Object { $_.Name -ceq $name })
            if ($entries.Count -ne 1) { throw "Expected one entry for $name" }
            $stream = $entries[0].Open()
            $hash = [Security.Cryptography.SHA256]::Create()
            try { $files[$name] = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
            finally { $stream.Dispose(); $hash.Dispose() }
        }
        $targets[$target] = $files
    } finally { $zip.Dispose() }
}
$manifest = [ordered]@{version = $version; targets = $targets} | ConvertTo-Json -Depth 4
$destination = [IO.Path]::GetFullPath((Join-Path $source 'administrator/windows-files.json'))
[IO.File]::WriteAllText($destination, ($manifest -replace "`r`n", "`n") + "`n", [Text.UTF8Encoding]::new($false))
Write-Output "Recorded verified CUA $version binaries for both Windows architectures."
